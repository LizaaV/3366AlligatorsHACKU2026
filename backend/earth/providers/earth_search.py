"""Sentinel-2 L2A from Earth Search (Element 84) on AWS: STAC search + windowed COG reads.

Only this module talks to the archive. It returns plain numpy arrays on a UTM grid around the
area; `earth.real` turns them into layers, indices and stats.

Facts verified against real items (3 Oct 2026), not assumed:
- Asset names: blue, green, red, nir, swir16, swir22, scl. Reflectance assets are uint16, nodata 0.
- The same tile and date can appear twice: `_0_L2A` (original) and `_1_L2A` (ESA reprocessing,
  baseline 05.00). Keep the highest version only.
- Processing-baseline offset: on Earth Search the pixels of every item with baseline >= 04.00
  are already on the old scale (reflectance = DN / 10000). Dark water / shadow DNs of 4-560 on
  items flagged `earthsearch:boa_offset_applied: true` *and* on the early-2022 04.00 items flagged
  `false` show the +1000 is NOT in the data. Subtracting 1000 would give negative reflectance.
  The STAC `raster:bands` offset of -0.1 is present even then: do not trust it. See `boa_offset`.
"""

from __future__ import annotations

import os
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
from rasterio.features import geometry_mask
from shapely.geometry import shape
from shapely.ops import transform

from earth import cache, settings
from earth.errors import EarthError
from earth.types import Area

PROVIDER_ID = "earth_search_s2"
SOURCE = "_source"  # extra key in read() results: which item filled each pixel
BAND_RES_M = {"blue": 10, "green": 10, "red": 10, "nir": 10, "swir16": 20, "swir22": 20, "scl": 20}

_UNREACHABLE_HINT = "Sentinel-2 archive not reachable; try again in a moment."
_configured = False
_config_lock = threading.Lock()
_client_local = threading.local()
_searches = cache.TTLCache(settings.SEARCH_TTL_S)


@dataclass
class Group:
    """One satellite pass over the area: all same-platform items of one solar day (tile edges)."""

    id: str  # id of the item covering most of the area
    date: date  # solar day at the area
    platform: str  # "sentinel-2b"
    items: list[Any] = field(default_factory=list)  # pystac Items, best coverage first

    @property
    def satellite(self) -> str:
        """ "sentinel-2b" → "Sentinel-2B"."""
        name, _, unit = self.platform.partition("-")
        return f"{name.capitalize()}-{unit.upper()}" if unit else self.platform

    @property
    def item_ids(self) -> list[str]:
        return [i.id for i in self.items]


def _configure() -> None:
    global _configured
    with _config_lock:
        if _configured:
            return
        import odc.stac

        os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")
        odc.stac.configure_rio(
            cloud_defaults=True,
            aws={"aws_unsigned": True},
            GDAL_HTTP_TIMEOUT=settings.S2_HTTP_TIMEOUT_S,
            GDAL_HTTP_CONNECTTIMEOUT=10,
            GDAL_HTTP_MAX_RETRY=3,
            GDAL_HTTP_RETRY_DELAY=1,
        )
        _configured = True


def _client() -> Any:
    from pystac_client import Client

    c = getattr(_client_local, "client", None)
    if c is None:
        c = Client.open(settings.STAC_URL, timeout=settings.S2_HTTP_TIMEOUT_S)
        _client_local.client = c
    return c


# --- search ---------------------------------------------------------------------------------------


def _version(item_id: str) -> int:
    """S2B_49QHE_20260930_0_L2A → 0 (Earth Search's reprocessing counter)."""
    try:
        return int(item_id.split("_")[-2])
    except (IndexError, ValueError):
        return 0


def _dedupe(items: list[Any]) -> list[Any]:
    """Keep one item per (tile, datetime): the highest reprocessing version."""
    best: dict[tuple[str, str], Any] = {}
    for it in items:
        parts = it.id.split("_")
        k = (parts[1] if len(parts) > 2 else it.id, it.properties.get("datetime", "")[:10])
        if k not in best or _version(it.id) > _version(best[k].id):
            best[k] = it
    return list(best.values())


def search(area: Area, start: date, end: date) -> list[Any]:
    """STAC items intersecting the area in [start, end], deduplicated. Metadata only: cheap."""
    k = cache.key("search", area.geojson, str(start), str(end))
    hit = _searches.get(k)
    if hit is not None:
        return hit
    try:
        found = _client().search(
            collections=[settings.S2_COLLECTION],
            intersects=area.geojson,
            datetime=f"{start.isoformat()}/{end.isoformat()}",
            query={"eo:cloud_cover": {"lt": settings.S2_TILE_CLOUD_PREFILTER}},
            limit=200,
            max_items=2000,
        )
        items = list(found.items())
    except Exception as exc:  # noqa: BLE001 — requests / pystac raise many types
        raise EarthError(f"Sentinel-2 search failed: {exc}", _UNREACHABLE_HINT) from exc
    items = _dedupe(items)
    _searches.put(k, items)
    return items


def _solar_day(item: Any, lon: float) -> date:
    dt = datetime.fromisoformat(item.properties["datetime"].replace("Z", "+00:00"))
    return (dt + timedelta(hours=lon / 15)).date()


def coverage(item: Any, area: Area) -> float:
    """Share of the area inside the item's data footprint, 0-1."""
    geom = area.geometry()
    try:
        return float(shape(item.geometry).intersection(geom).area / geom.area)
    except Exception:  # noqa: BLE001 — invalid footprints: assume full
        return 1.0


def group(items: list[Any], area: Area) -> list[Group]:
    """One Group per (solar day, platform), newest first. Items ordered best coverage first."""
    lon = area.centroid()[1]
    buckets: dict[tuple[date, str], list[Any]] = defaultdict(list)
    for it in items:
        buckets[(_solar_day(it, lon), it.properties.get("platform", "sentinel-2"))].append(it)
    out = []
    for (day, platform), its in buckets.items():
        its.sort(key=lambda i: (-round(coverage(i, area), 3), i.id))
        out.append(Group(id=its[0].id, date=day, platform=platform, items=its))
    out.sort(key=lambda g: (g.date, g.id), reverse=True)
    return out


# --- grid -----------------------------------------------------------------------------------------


def geobox(area: Area, resolution_m: float) -> Any:
    from odc.geo.geobox import GeoBox
    from odc.geo.geom import Geometry

    poly = Geometry(area.geojson, crs="EPSG:4326").to_crs(f"EPSG:{area.utm_epsg()}")
    return GeoBox.from_geopolygon(poly, resolution=resolution_m)


def choose_resolution(area: Area, finest: float = 10) -> float:
    """The finest resolution ≥ `finest` whose grid stays under MAX_PIXELS_PER_READ."""
    for res in settings.RESOLUTIONS_M:
        if res < finest:
            continue
        h, w = geobox(area, res).shape
        if h * w <= settings.MAX_PIXELS_PER_READ:
            return float(res)
    from earth.errors import BudgetExceeded

    raise BudgetExceeded(
        f"{area.area_ha:.0f} ha is too large even at {settings.RESOLUTIONS_M[-1]} m.",
        "draw a smaller outline",
    )


def area_mask(area: Area, gbox: Any) -> np.ndarray:
    """True for pixels whose centre is inside the area polygon."""
    from pyproj import Transformer

    fwd = Transformer.from_crs("EPSG:4326", f"EPSG:{area.utm_epsg()}", always_xy=True).transform
    geom = transform(fwd, area.geometry())
    h, w = gbox.shape
    return geometry_mask([geom], out_shape=(h, w), transform=gbox.transform, invert=True)


def wgs84_bounds(gbox: Any) -> tuple[float, float, float, float]:
    b = gbox.extent.to_crs("EPSG:4326").boundingbox
    return (float(b.left), float(b.bottom), float(b.right), float(b.top))


# --- reads ----------------------------------------------------------------------------------------


def boa_offset(item: Any) -> int:
    """DN offset to subtract before /10000. 0 for every Earth Search item seen (see module doc).

    Baseline < 04.00 never had the offset; `earthsearch:boa_offset_applied: true` means it was
    removed; the 04.00 items flagged false (Jan-Mar 2022) were checked and are not offset either.
    """
    return 0


def _load_item(item: Any, bands: list[str], gbox: Any) -> dict[str, np.ndarray]:
    import odc.stac

    resampling = {b: ("nearest" if b == "scl" else "bilinear") for b in bands}
    ds = odc.stac.load(
        [item], bands=bands, geobox=gbox, groupby="id", resampling=resampling, chunks=None
    )
    return {b: ds[b].values[0] for b in bands}


def read(items: list[Any], bands: list[str], gbox: Any) -> dict[str, np.ndarray]:
    """Mosaic of `bands` over the grid: first item with data wins (items are best-coverage first).

    Reflectance bands → float32 reflectance with NaN for no data; `scl` → uint8 with 0 = no data.
    Also returns SOURCE: int8 index into `items` of the item that filled each pixel of the first
    band (-1 = no data), so callers can tell which tiles contributed. Cached on disk per
    (items, bands, grid).
    """
    k = cache.key(
        settings.S2_COLLECTION,
        [i.id for i in items],
        sorted(bands),
        str(gbox.crs),
        list(gbox.transform)[:6],
        list(gbox.shape),
    )
    hit = cache.get_arrays(k)
    if hit is not None and set(bands) | {SOURCE} <= set(hit):
        return hit
    _configure()
    h, w = gbox.shape
    out: dict[str, np.ndarray] = {
        b: np.zeros((h, w), np.uint8) if b == "scl" else np.full((h, w), np.nan, np.float32)
        for b in bands
    }
    out[SOURCE] = np.full((h, w), -1, np.int8)
    try:
        for n, item in enumerate(items):
            missing = [b for b in bands if _has_gaps(out[b])]
            if not missing:
                break
            raw = _load_item(item, missing, gbox)
            off = boa_offset(item)
            for b in missing:
                dn = raw[b]
                gap = out[b] == 0 if b == "scl" else np.isnan(out[b])
                fill = gap & (dn != 0)
                if b == bands[0]:
                    out[SOURCE][fill] = n
                if b == "scl":
                    out[b][fill] = dn[fill].astype(np.uint8)
                else:
                    out[b][fill] = (dn[fill].astype(np.float32) - off) / 10_000
    except EarthError:
        raise
    except Exception as exc:  # noqa: BLE001 — rasterio / GDAL / HTTP errors
        raise EarthError(f"Reading Sentinel-2 pixels failed: {exc}", _UNREACHABLE_HINT) from exc
    cache.put_arrays(k, out)
    return out


def _has_gaps(a: np.ndarray) -> bool:
    return bool((a == 0).any()) if a.dtype == np.uint8 else bool(np.isnan(a).any())


def read_many(jobs: list[tuple[list[Any], list[str], Any]]) -> list[dict[str, np.ndarray]]:
    """`read` for several (items, bands, grid) jobs, READ_THREADS at a time, order kept."""
    if len(jobs) <= 1:
        return [read(*j) for j in jobs]
    with ThreadPoolExecutor(max_workers=settings.READ_THREADS) as pool:
        return list(pool.map(lambda j: read(*j), jobs))
