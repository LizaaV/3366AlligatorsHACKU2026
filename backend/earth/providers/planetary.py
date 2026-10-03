"""Microsoft Planetary Computer: terrain (Copernicus DEM) and land cover (ESA WorldCover).

Both read only the area's pixels (odc-stac windowed COG reads), in the area's UTM CRS.
Sentinel-1 radar (M9b) will be added to this module later; leave `_catalog()` shared.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import numpy as np
from pydantic import BaseModel

from earth import settings
from earth.errors import EarthError
from earth.types import Area, Range, SlopeStats

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
