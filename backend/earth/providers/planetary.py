"""Microsoft Planetary Computer: terrain (Copernicus DEM) and land cover (ESA WorldCover).

Both read only the area's pixels (odc-stac windowed COG reads), in the area's UTM CRS.
Sentinel-1 RTC radar (M9b, the cloud fallback) is the last section; `_catalog()` is shared.
"""

from __future__ import annotations

import hashlib
import json
import math
import threading
import time
from datetime import date, datetime
from pathlib import Path

import numpy as np
from affine import Affine
from pydantic import BaseModel

from earth import settings
from earth.errors import EarthError
from earth.types import Area, Provenance, Range, Scene, SlopeStats, Stats

DEM_COLLECTION = "cop-dem-glo-30"
DEM_ASSET = "data"
WORLDCOVER_COLLECTION = "esa-worldcover"
WORLDCOVER_ASSET = "map"

# ESA WorldCover class values, verified against the item's `classification:classes`.
WORLDCOVER_CLASSES: dict[int, str] = {
    10: "trees",
    20: "shrubland",
    30: "grassland",
    40: "cropland",
    50: "built",
    60: "bare",
    70: "snow_ice",
    80: "water",
    90: "wetland",
    95: "mangroves",
    100: "moss_lichen",
}


class Terrain(BaseModel):
    elevation_m: Range
    slope_deg: SlopeStats
    resolution_m: float
    source: str = "Copernicus DEM GLO-30"


class LandCover(BaseModel):
    shares: dict[str, float]  # class name → share 0–1, descending, sums to ~1
    year: int
    resolution_m: float
    source: str = "ESA WorldCover 10 m"


# --- disk cache ---------------------------------------------------------------------------------


def _cache_path(collection: str, area: Area) -> Path:
    geom = json.dumps(_round(area.geojson), sort_keys=True)
    key = hashlib.sha1(f"{collection}|{area.bbox()}|{geom}".encode()).hexdigest()[:24]
    return settings.data_dir() / "cache" / "planetary" / f"{collection}-{key}.json"


def _round(obj):
    if isinstance(obj, float):
        return round(obj, 6)
    if isinstance(obj, list | tuple):
        return [_round(o) for o in obj]
    if isinstance(obj, dict):
        return {k: _round(v) for k, v in obj.items()}
    return obj


def _cache_get(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def _cache_put(path: Path, data: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{id(data)}.tmp")
        tmp.write_text(json.dumps(data))
        tmp.replace(path)
    except OSError:
        pass  # cache is best effort


# --- STAC + raster helpers ----------------------------------------------------------------------


def _catalog():
    import planetary_computer
    from pystac_client import Client

    return Client.open(
        settings.PC_STAC_URL,
        modifier=planetary_computer.sign_inplace,
        timeout=settings.HTTP_TIMEOUT_S,
    )


def _search(collection: str, bbox: tuple[float, float, float, float]) -> list:
    try:
        items = list(_catalog().search(collections=[collection], bbox=bbox).items())
    except Exception as exc:  # noqa: BLE001 — network / STAC errors vary
        raise EarthError(
            f"Planetary Computer search failed for {collection}: {exc}",
            "Retry in a moment; the service may be busy.",
        ) from exc
    if not items:
        raise EarthError(
            f"No {collection} data covers this area.",
            "Coverage can be missing at the poles or over open ocean.",
        )
    return items


def _resolution(area: Area, base_m: float) -> float:
    """base_m, or coarser when the area would need more than the pixel budget."""
    width_m, height_m = _extent_m(area)
    cells = (width_m / base_m) * (height_m / base_m)
    if cells <= settings.CONTEXT_MAX_READ_PIXELS:
        return base_m
    return base_m * math.ceil(math.sqrt(cells / settings.CONTEXT_MAX_READ_PIXELS))


def _extent_m(area: Area) -> tuple[float, float]:
    from pyproj import Transformer
    from shapely.ops import transform

    fwd = Transformer.from_crs("EPSG:4326", f"EPSG:{area.utm_epsg()}", always_xy=True).transform
    minx, miny, maxx, maxy = transform(fwd, area.geometry()).bounds
    return maxx - minx, maxy - miny


def _load(items: list, asset: str, area: Area, res: float, pad_m: float, resampling: str):
    """Mosaic of `items` over the area (padded by pad_m), in UTM, as (2-D array, transform)."""
    import odc.stac
    from pyproj import Transformer
    from shapely.geometry import box
    from shapely.ops import transform

    epsg = area.utm_epsg()
    to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True).transform
    to_wgs = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True).transform
    minx, miny, maxx, maxy = transform(to_utm, area.geometry()).bounds
    padded = box(minx - pad_m, miny - pad_m, maxx + pad_m, maxy + pad_m)
    bbox = transform(to_wgs, padded).bounds
    try:
        ds = odc.stac.load(
            items,
            bands=[asset],
            crs=f"EPSG:{epsg}",
            resolution=res,
            bbox=bbox,
            resampling=resampling,
            chunks=None,
        )
    except Exception as exc:  # noqa: BLE001
        raise EarthError(
            f"Could not read {asset} pixels: {exc}", "Retry in a moment, or try a smaller area."
        ) from exc
    arr = ds[asset].isel(time=0) if "time" in ds[asset].dims else ds[asset]
    return np.asarray(arr.values), arr.odc.geobox.transform


def _polygon_mask(area: Area, shape: tuple[int, int], transform) -> np.ndarray:
    """True for pixels whose centre lies inside the area (all touched, then nearest, if empty)."""
    from pyproj import Transformer
    from rasterio.features import geometry_mask
    from shapely.ops import transform as shp_transform

    fwd = Transformer.from_crs("EPSG:4326", f"EPSG:{area.utm_epsg()}", always_xy=True).transform
    geom = shp_transform(fwd, area.geometry())
    mask = geometry_mask([geom], out_shape=shape, transform=transform, invert=True)
    if not mask.any():
        mask = geometry_mask(
            [geom], out_shape=shape, transform=transform, invert=True, all_touched=True
        )
    if not mask.any():
        c = geom.centroid
        col, row = ~transform * (c.x, c.y)
        mask[min(max(int(row), 0), shape[0] - 1), min(max(int(col), 0), shape[1] - 1)] = True
    return mask


# --- Copernicus DEM -----------------------------------------------------------------------------


def slope_degrees(z: np.ndarray, res_m: float) -> np.ndarray:
    """Slope in degrees from a projected elevation grid (metres), via central differences."""
    dzdy, dzdx = np.gradient(z, res_m)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def terrain(area: Area) -> Terrain:
    """Elevation range and slope (mean, p90) inside the area, from Copernicus DEM at 30 m."""
    path = _cache_path(DEM_COLLECTION, area)
    if (hit := _cache_get(path)) is not None:
        return Terrain.model_validate(hit)
    items = _search(DEM_COLLECTION, area.bbox())
    res = _resolution(area, 30.0)
    z, tr = _load(items, DEM_ASSET, area, res, pad_m=2 * res, resampling="bilinear")
    z = z.astype("float64")
    z[~np.isfinite(z) | (z < -500)] = np.nan  # nodata
    slope = slope_degrees(z, res)
    mask = _polygon_mask(area, z.shape, tr) & np.isfinite(z) & np.isfinite(slope)
    if not mask.any():
        raise EarthError("The DEM has no valid pixels here.", "Probably open ocean or no coverage.")
    elev, sl = z[mask], slope[mask]
    out = Terrain(
        elevation_m=Range(min=round(float(elev.min()), 1), max=round(float(elev.max()), 1)),
        slope_deg=SlopeStats(
            mean=round(float(sl.mean()), 1), p90=round(float(np.percentile(sl, 90)), 1)
        ),
        resolution_m=res,
    )
    _cache_put(path, out.model_dump(mode="json"))
    return out


# --- ESA WorldCover -----------------------------------------------------------------------------


def _item_year(item) -> int:
    props = item.properties
    stamp = props.get("start_datetime") or (item.datetime.isoformat() if item.datetime else "")
    return int(str(stamp)[:4] or 0)


def worldcover(area: Area) -> LandCover:
    """Land-cover shares inside the area from the latest ESA WorldCover year, at 10 m."""
    path = _cache_path(WORLDCOVER_COLLECTION, area)
    if (hit := _cache_get(path)) is not None:
        return LandCover.model_validate(hit)
    items = _search(WORLDCOVER_COLLECTION, area.bbox())
    year = max(_item_year(i) for i in items)
    latest = [i for i in items if _item_year(i) == year]
    res = _resolution(area, 10.0)
    arr, tr = _load(latest, WORLDCOVER_ASSET, area, res, pad_m=0, resampling="nearest")
    mask = _polygon_mask(area, arr.shape, tr) & (arr > 0)
    if not mask.any():
        raise EarthError("WorldCover has no land-cover pixels here.", "Probably open ocean.")
    values, counts = np.unique(arr[mask], return_counts=True)
    total = counts.sum()
    shares = {
        WORLDCOVER_CLASSES.get(int(v), f"class_{int(v)}"): round(float(c) / float(total), 3)
        for v, c in sorted(zip(values, counts, strict=True), key=lambda vc: -vc[1])
        if c / total >= 0.0005
    }
    out = LandCover(shares=shares, year=year, resolution_m=res)
    _cache_put(path, out.model_dump(mode="json"))
    return out


# --- Sentinel-1 RTC radar (M9b) -----------------------------------------------------------------
# Collection `sentinel-1-rtc`: radiometrically terrain corrected gamma0, linear power, float32,
# nodata -32768, assets `vv` / `vh`, 10 m, UTM per item. A pass is cut into slices, so one
# overpass can be several items: we group items of the same day + platform + orbit into one scene.
# Radar sees through cloud, but only compare passes with the SAME orbit direction (ideally the
# same relative orbit): ascending vs descending differ by several dB from viewing geometry alone.

S1_PROVIDER = "planetary_s1_rtc"
S1_NODATA = -32768.0
_S1_FLOOR = 1e-6  # linear power at or below this (-60 dB) is treated as no data


class RadarScene(BaseModel):
    """One Sentinel-1 overpass over an area (1+ STAC items of the same day/platform/orbit)."""

    id: str  # "S1D_20260928_asc_R011_rtc"
    date: date
    platform: str  # "Sentinel-1D"
    orbit_state: str  # "ascending" | "descending"
    relative_orbit: int | None
    polarizations: list[str]  # lower-case, e.g. ["vv", "vh"]
    item_ids: list[str]

    def to_scene(self) -> Scene:
        return Scene(
            id=self.id,
            date=self.date,
            satellite=self.platform,
            provider=S1_PROVIDER,
            kind="radar",
            cloud_over_area=0.0,
            usable=True,
            resolution_m=10,
        )


_REGISTRY: dict[str, RadarScene] = {}  # scene id → RadarScene, filled by search_s1


def _platform(raw: str | None) -> str:
    """'sentinel-1d' → 'Sentinel-1D'."""
    suffix = (raw or "sentinel-1").rsplit("-", 1)[-1].upper()
    return f"Sentinel-{suffix}"


def _scene_id(platform: str, d: date, orbit_state: str, rel: int | None) -> str:
    rel_tag = f"_R{rel:03d}" if rel is not None else ""
    return f"S{platform[-2:]}_{d:%Y%m%d}_{orbit_state[:3]}{rel_tag}_rtc"


def group_items(items: list) -> list[RadarScene]:
    """Group STAC items (same day, platform, orbit, relative orbit) into scenes, newest first."""
    groups: dict[tuple, list] = {}
    for it in items:
        p = it.properties
        stamp = it.datetime or datetime.fromisoformat(str(p["datetime"]).replace("Z", "+00:00"))
        key = (
            stamp.date(),
            p.get("platform"),
            str(p.get("sat:orbit_state", "unknown")).lower(),
            p.get("sat:relative_orbit"),
        )
        groups.setdefault(key, []).append(it)
    out = []
    for (d, plat, state, rel), its in groups.items():
        platform = _platform(plat)
        pols = [a for a in ("vv", "vh") if all(a in i.assets for i in its)]
        out.append(
            RadarScene(
                id=_scene_id(platform, d, state, rel),
                date=d,
                platform=platform,
                orbit_state=state,
                relative_orbit=rel,
                polarizations=pols,
                item_ids=sorted(i.id for i in its),
            )
        )
    out.sort(key=lambda s: (s.date, s.id), reverse=True)
    return out


def same_orbit(
    scenes: list[RadarScene], orbit_state: str | None = None, relative_orbit: int | None = None
) -> list[RadarScene]:
    """Only scenes of one orbit direction (default: the most common one), newest first.

    Never mix ascending and descending when comparing backscatter. Pass `relative_orbit` to pin
    one track as well (same incidence angle: the cleanest comparison).
    """
    if orbit_state is None:
        if not scenes:
            return []
        counts: dict[str, int] = {}
        for s in scenes:
            counts[s.orbit_state] = counts.get(s.orbit_state, 0) + 1
        orbit_state = max(counts, key=lambda k: (counts[k], k))
    out = [s for s in scenes if s.orbit_state == orbit_state]
    if relative_orbit is not None:
        out = [s for s in out if s.relative_orbit == relative_orbit]
    return sorted(out, key=lambda s: (s.date, s.id), reverse=True)


def search_s1(area: Area, start: date, end: date) -> list[RadarScene]:
    """Sentinel-1 RTC overpasses over the area between start and end (inclusive), newest first."""
    if start > end:
        raise EarthError(f"Search window is backwards ({start} > {end}).", "Pass start <= end.")
    path = _cache_path(f"s1search-{start}-{end}", area)
    cached = _cache_get(path)
    if cached and time.time() - cached.get("at", 0) < settings.S1_SEARCH_TTL_S:
        scenes = [RadarScene.model_validate(s) for s in cached["scenes"]]
    else:
        try:
            found = list(
                _catalog()
                .search(
                    collections=[settings.S1_COLLECTION],
                    intersects=area.geojson,
                    datetime=f"{start.isoformat()}/{end.isoformat()}",
                    max_items=500,
                )
                .items()
            )
        except Exception as exc:  # noqa: BLE001
            raise EarthError(
                f"Radar search failed: {exc}", "Planetary Computer slow; try again in a moment."
            ) from exc
        scenes = group_items(found)
        now = time.time()
        _ITEMS.update({i.id: (now, i) for i in found})  # signed at search time
        _cache_put(path, {"at": time.time(), "scenes": [s.model_dump(mode="json") for s in scenes]})
    for s in scenes:
        _REGISTRY[s.id] = s
    return scenes


def resolve_scene(area: Area, scene: RadarScene | Scene) -> RadarScene:
    """A RadarScene from a RadarScene, or from the `Scene` made by `RadarScene.to_scene()`."""
    if isinstance(scene, RadarScene):
        return scene
    if scene.id in _REGISTRY:
        return _REGISTRY[scene.id]
    for s in search_s1(area, scene.date, scene.date):  # fresh process: look that day up again
        if s.id == scene.id:
            return s
    raise EarthError(
        f"Radar scene {scene.id} not found over this area.",
        'Call scenes(area, kind="radar") again and pick one of those.',
    )


_ITEMS: dict[str, tuple[float, object]] = {}  # item id → (time stashed, STAC item), this process
_ITEM_TTL_S = 20 * 60  # signed asset URLs last about an hour; refetch well before that


def _items_by_id(ids: list[str]) -> list:
    """STAC items with fresh signed URLs: from this process's search results, else one lookup."""
    now = time.time()
    if all(i in _ITEMS and now - _ITEMS[i][0] < _ITEM_TTL_S for i in ids):
        return [_ITEMS[i][1] for i in ids]
    try:
        items = list(
            _catalog()
            .search(collections=[settings.S1_COLLECTION], ids=ids, max_items=len(ids))
            .items()
        )
    except Exception as exc:  # noqa: BLE001
        raise EarthError(
            f"Radar item lookup failed: {exc}", "Planetary Computer slow; try again in a moment."
        ) from exc
    _ITEMS.update({i.id: (now, i) for i in items})
    return items


def linear_to_db(lin: np.ndarray) -> np.ndarray:
    """10·log10 of linear power; nodata (-32768), NaN, inf and values <= 1e-6 become NaN."""
    lin = np.asarray(lin, dtype="float64")
    bad = ~np.isfinite(lin) | (lin == S1_NODATA) | (lin <= _S1_FLOOR)
    safe = np.where(bad, 1.0, lin)
    return np.where(bad, np.nan, 10.0 * np.log10(safe))


def smooth3x3(lin: np.ndarray) -> np.ndarray:
    """NaN-aware 3x3 mean (speckle reduction). NaN pixels stay NaN."""
    valid = np.isfinite(lin)
    zp = np.pad(np.where(valid, lin, 0.0), 1)
    vp = np.pad(valid.astype("float64"), 1)
    h, w = lin.shape
    num = sum(zp[i : i + h, j : j + w] for i in range(3) for j in range(3))
    den = sum(vp[i : i + h, j : j + w] for i in range(3) for j in range(3))
    return np.where(valid, num / np.maximum(den, 1.0), np.nan)


def _within(seconds: float, fn, *args):
    """Run fn(*args) with a wall-clock timeout; a stuck read becomes a hinted EarthError."""
    box: dict = {}

    def run():
        try:
            box["v"] = fn(*args)
        except BaseException as exc:  # noqa: BLE001 — re-raised in the caller
            box["e"] = exc

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(seconds)
    if t.is_alive():
        raise EarthError(
            f"Radar pixel read took longer than {seconds:.0f} s.",
            "Planetary Computer slow; try again, or use a smaller area.",
        )
    if "e" in box:
        raise box["e"]
    return box["v"]


def read_s1(
    area: Area,
    scene: RadarScene | Scene,
    pol: str = "vv",
    resolution_m: float = 10,
    smooth: bool = True,
):
    """Backscatter (dB) over the area for one overpass: (2-D float array, affine transform).

    Pixels outside the polygon and nodata are NaN. dB = 10·log10(gamma0 linear power). With
    `smooth` (default) a 3x3 mean is applied in LINEAR space, inside the polygon only, before
    converting to dB (~4.4-look speckle would otherwise widen p10/p90). The transform is in the
    area's UTM CRS; `grid_bounds` turns the grid into WGS84 bounds. Cached on disk.
    """
    pol = pol.lower()
    sc = resolve_scene(area, scene)
    if pol not in sc.polarizations:
        raise EarthError(
            f"Scene {sc.id} has no {pol.upper()} band (has {sc.polarizations}).",
            f'Use pol="{sc.polarizations[0]}".' if sc.polarizations else None,
        )
    res = _resolution(area, resolution_m)
    w_m, h_m = _extent_m(area)
    cells = (w_m / res) * (h_m / res)
    if cells > settings.S1_MAX_READ_PIXELS:
        res *= math.ceil(math.sqrt(cells / settings.S1_MAX_READ_PIXELS))
    path = _cache_path(f"s1px-{sc.id}-{pol}-{res:g}-{int(smooth)}", area).with_suffix(".npz")
    try:
        with np.load(path) as z:
            return z["db"].astype("float64"), Affine(*z["tr"])
    except (OSError, ValueError, KeyError):
        pass
    items = _items_by_id(sc.item_ids)
    if not items:
        raise EarthError(f"Radar scene {sc.id} is no longer in the catalogue.", "Search again.")
    lin, tr = _within(settings.S1_READ_TIMEOUT_S, _load, items, pol, area, res, 0, "bilinear")
    lin = lin.astype("float64")
    lin[~np.isfinite(lin) | (lin == S1_NODATA) | (lin <= _S1_FLOOR)] = np.nan
    lin[~_polygon_mask(area, lin.shape, tr)] = np.nan
    if smooth:
        lin = smooth3x3(lin)
    db = linear_to_db(lin)
    if not np.isfinite(db).any():
        raise EarthError(
            f"Radar scene {sc.id} has no valid pixels over this area.",
            "The overpass may only clip the edge; try another date.",
        )
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f"{path.stem}.{threading.get_ident()}.tmp.npz")
        np.savez_compressed(tmp, db=db.astype("float32"), tr=np.array(tr)[:6])
        tmp.replace(path)
    except OSError:
        pass  # cache is best effort
    return db, tr


def grid_bounds(area: Area, shape: tuple[int, int], transform) -> tuple[float, float, float, float]:
    """WGS84 (west, south, east, north) of a UTM grid returned by `read_s1`."""
    from pyproj import Transformer

    h, w = shape
    to_wgs = Transformer.from_crs(f"EPSG:{area.utm_epsg()}", "EPSG:4326", always_xy=True).transform
    t = transform
    pts = [to_wgs(t.a * c + t.b * r + t.c, t.d * c + t.e * r + t.f) for c in (0, w) for r in (0, h)]
    lons, lats = zip(*pts, strict=True)
    return min(lons), min(lats), max(lons), max(lats)


def roughness_stats(
    area: Area, scene: RadarScene | Scene, pol: str = "vv", db: np.ndarray | None = None
) -> Stats:
    """Mean/median/p10/p90 backscatter (dB) over the area for one overpass, with provenance."""
    sc = resolve_scene(area, scene)
    if db is None:
        db, _ = read_s1(area, sc, pol)
    vals = db[np.isfinite(db)]
    if not vals.size:
        raise EarthError("No valid radar pixels inside the area.", "Try a larger area.")
    p10, med, p90 = np.percentile(vals, [10, 50, 90])
    track = f" (relative orbit {sc.relative_orbit})" if sc.relative_orbit is not None else ""
    return Stats(
        mean=round(float(vals.mean()), 2),
        median=round(float(med), 2),
        p10=round(float(p10), 2),
        p90=round(float(p90), 2),
        clean_px=int(vals.size),
        cloud=0.0,
        provenance=Provenance(
            provider=S1_PROVIDER,
            satellite=sc.platform,
            scene=sc.id,
            date=sc.date,
            cloud_over_area=0.0,
            resolution_m=10,
            method=(
                f"Mean {pol.upper()} backscatter (dB), RTC gamma0, {sc.orbit_state} orbit{track}, "
                f"over {vals.size} pixels"
            ),
        ),
    )
