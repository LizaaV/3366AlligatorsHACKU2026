"""Suggest a field outline around a point (`POST /api/places/detect-boundary`).

Pipeline (real or stub `earth`, chosen by EARTH_IMPL):
  1. read the latest clear Sentinel-2 scene over a ~600 m square around the point and compute
     NDVI ("greenness") and NDWI ("water") through the public `earth` functions;
  2. region-grow from the seed pixel (4-connected flood fill over pixels whose NDVI *and* NDWI
     are within a tolerance of the seed's), capped at MAX_REGION_HA;
  3. vectorise the mask with `rasterio.features.shapes`, keep the polygon containing the seed,
     fill its holes, simplify (~5 m) in UTM and return it in EPSG:4326.

It never fails: no clear scene, provider error, timeout, or a degenerate region (< 0.05 ha, or
the cap / the whole box) gives a ~1 ha square around the point, confidence "Low".
"""

from __future__ import annotations

import logging
import math
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass
from datetime import date
from typing import Literal

import numpy as np
from pyproj import CRS, Transformer
from rasterio.features import shapes
from rasterio.transform import from_bounds
from shapely.geometry import Point, Polygon, shape
from shapely.ops import transform

import earth
from app.schemas.places import DetectBoundaryResponse

log = logging.getLogger(__name__)

BOX_M = 600  # side of the square read around the point
FALLBACK_SIDE_M = 100  # 1 ha
MAX_REGION_HA = 200
MIN_REGION_HA = 0.05
SIMPLIFY_M = 5
SMOOTH_M = 10  # one pixel: closes notches and drops spurs before simplifying
SCENE_WINDOW = "90d"
TIMEOUT_S = 60  # whole pixel read; cold it takes ~35 s (scene scan + 3 reads)
TOL_MIN, TOL_MAX, TOL_NOISE = 0.06, 0.20, 2.5  # index tolerance = 2.5 x local std, clamped

Confidence = Literal["High", "Medium", "Low"]
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="detect-boundary")


@dataclass
class IndexGrid:
    """Two co-registered north-up index rasters (NaN = no data) and their WGS84 bounds."""

    ndvi: np.ndarray
    ndwi: np.ndarray
    bounds: tuple[float, float, float, float]  # west, south, east, north
    scene_date: date | None = None
    cloud: float = 0.0


def _local(lat: float, lon: float) -> tuple[Transformer, Transformer]:
    crs = CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +units=m +datum=WGS84")
    return (
        Transformer.from_crs("EPSG:4326", crs, always_xy=True),
        Transformer.from_crs(crs, "EPSG:4326", always_xy=True),
    )


def square_geojson(lat: float, lon: float, side_m: float) -> dict:
    """A square of `side_m` centred on the point, as a GeoJSON Polygon in lon/lat."""
    _, back = _local(lat, lon)
    h = side_m / 2
    ring = [back.transform(x, y) for x, y in ((-h, -h), (h, -h), (h, h), (-h, h), (-h, -h))]
    return {"type": "Polygon", "coordinates": [[list(p) for p in ring]]}


def read_indices(lat: float, lon: float) -> IndexGrid | None:
    """Latest clear Sentinel-2 scene around the point → NDVI + NDWI. None when there is none.

    Uses the undecorated `earth` functions: the `@traced` wrappers count calls in a process-global
    budget meant for one agent run, which would break a long-lived API process.
    """
    raw = lambda fn: getattr(fn, "__wrapped__", fn)  # noqa: E731
    area = earth.Area.from_geojson(square_geojson(lat, lon, BOX_M), name="boundary probe")
    found = raw(earth.scenes)(area, last=SCENE_WINDOW, kind="optical", max_cloud=30)
    clear = found.clear()
    if not clear:
        return None
    scene = clear[0]
    impl = earth._impl()
    made: list[str] = []
    try:
        base = raw(earth.load)(area, scene)
        made.append(base.id)
        green = raw(earth.index)(base, "greenness")
        made.append(green.id)
        water = raw(earth.index)(base, "water")
        made.append(water.id)
        ndvi, bounds = impl.layer_pixels(green.id)
        ndwi, _ = impl.layer_pixels(water.id)
    finally:  # the implementation keeps layers in memory for the run; this is not one
        store = getattr(impl, "_layers", None)
        if isinstance(store, dict):
            for lid in made:
                store.pop(lid, None)
    return IndexGrid(
        np.asarray(ndvi, dtype=np.float32),
        np.asarray(ndwi, dtype=np.float32),
        tuple(bounds),  # type: ignore[arg-type]
        scene.date,
        scene.cloud_over_area,
    )


# --- region growing -----------------------------------------------------------------------------


def _seed_pixel(grid: IndexGrid, lat: float, lon: float) -> tuple[int, int] | None:
    h, w = grid.ndvi.shape
    west, south, east, north = grid.bounds
    if not (west <= lon <= east and south <= lat <= north):
        return None
    col = min(w - 1, int((lon - west) / (east - west) * w))
    row = min(h - 1, int((north - lat) / (north - south) * h))
    return row, col


def grow_region(
    ndvi: np.ndarray, ndwi: np.ndarray, seed: tuple[int, int], max_px: int
) -> tuple[np.ndarray, bool]:
    """4-connected flood fill from `seed` over pixels close to the seed's NDVI and NDWI.

    The tolerance follows the noise around the seed (2.5 x std of its 5x5 window, clamped), so a
    smooth pond is traced tightly and a textured crop field loosely. Returns (mask, capped);
    `capped` means the region reached `max_px` and growth stopped.
    """
    h, w = ndvi.shape
    r0, c0 = seed
    win = (slice(max(0, r0 - 2), r0 + 3), slice(max(0, c0 - 2), c0 + 3))
    out: list[tuple[float, float]] = []
    for band in (ndvi, ndwi):
        vals = band[win][np.isfinite(band[win])]
        if vals.size == 0:
            return np.zeros((h, w), dtype=bool), False
        out.append((float(np.median(vals)), float(np.std(vals))))
    (v_ref, v_sd), (w_ref, w_sd) = out
    v_tol = min(TOL_MAX, max(TOL_MIN, TOL_NOISE * v_sd))
    w_tol = min(TOL_MAX, max(TOL_MIN, TOL_NOISE * w_sd))
    ok = (np.abs(ndvi - v_ref) <= v_tol) & (np.abs(ndwi - w_ref) <= w_tol)  # NaN -> False

    mask = np.zeros((h, w), dtype=bool)
    if not ok[r0, c0]:
        ok[r0, c0] = True  # the seed itself is always in
    mask[r0, c0] = True
    queue: deque[tuple[int, int]] = deque([seed])
    count = 1
    while queue:
        r, c = queue.popleft()
        for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
            if 0 <= nr < h and 0 <= nc < w and ok[nr, nc] and not mask[nr, nc]:
                mask[nr, nc] = True
                queue.append((nr, nc))
                count += 1
                if count >= max_px:
                    return mask, True
    return mask, False


def _vectorise(grid: IndexGrid, mask: np.ndarray, lat: float, lon: float) -> Polygon | None:
    """The mask polygon (holes filled) that contains the seed, in WGS84."""
    tf = from_bounds(*grid.bounds, mask.shape[1], mask.shape[0])
    seed = Point(lon, lat)
    best: Polygon | None = None
    for geom, value in shapes(mask.astype(np.uint8), mask=mask, transform=tf, connectivity=4):
        if value != 1:
            continue
        poly = Polygon(shape(geom).exterior)  # drop holes: a field with a tree is still a field
        if poly.contains(seed) or poly.distance(seed) < 1e-9:
            return poly
        if best is None or poly.area > best.area:
            best = poly
    return best


def _simplified(poly: Polygon, lat: float, lon: float) -> Polygon | None:
    fwd, back = _local(lat, lon)
    metric = transform(fwd.transform, poly)
    smooth = metric.buffer(SMOOTH_M).buffer(-2 * SMOOTH_M).buffer(SMOOTH_M)  # close, then open
    if not smooth.is_empty and smooth.area > 0.5 * metric.area:
        metric = smooth
    metric = metric.simplify(SIMPLIFY_M, preserve_topology=True)
    if metric.is_empty:
        return None
    if not metric.is_valid:
        metric = metric.buffer(0)
    if metric.geom_type == "MultiPolygon":
        metric = max(metric.geoms, key=lambda g: g.area)
    if metric.geom_type != "Polygon" or metric.is_empty:
        return None
    return Polygon(transform(back.transform, Polygon(metric.exterior)).exterior)


def _confidence(grid: IndexGrid, poly: Polygon, mask: np.ndarray, area_ha: float) -> Confidence:
    edge = mask[0].any() or mask[-1].any() or mask[:, 0].any() or mask[:, -1].any()
    solidity = poly.area / poly.convex_hull.area if poly.convex_hull.area else 0.0
    if edge:
        return "Low"
    if grid.cloud <= 0.1 and area_ha >= 0.5 and solidity >= 0.85:
        return "High"
    return "Medium"


def segment(grid: IndexGrid, lat: float, lon: float) -> DetectBoundaryResponse | None:
    """Outline from imagery, or None when the region is unusable (caller falls back)."""
    seed = _seed_pixel(grid, lat, lon)
    if seed is None or grid.ndvi.shape != grid.ndwi.shape:
        return None
    west, south, east, north = grid.bounds
    h, w = grid.ndvi.shape
    m_per_deg_lat = 111_320.0
    px_ha = (
        ((east - west) * m_per_deg_lat * math.cos(math.radians(lat)) / w)
        * ((north - south) * m_per_deg_lat / h)
        / 10_000
    )
    max_px = max(1, int(MAX_REGION_HA / px_ha))
    mask, capped = grow_region(grid.ndvi, grid.ndwi, seed, max_px)
    if capped or mask.sum() * px_ha < MIN_REGION_HA or mask.mean() > 0.9:
        return None  # ran away (or covers the whole box), or too small to be a field
    poly = _vectorise(grid, mask, lat, lon)
    if poly is None:
        return None
    poly = _simplified(poly, lat, lon)
    if poly is None:
        return None
    geojson = {"type": "Polygon", "coordinates": [[list(p) for p in poly.exterior.coords]]}
    try:
        area = earth.Area.from_geojson(geojson)
    except earth.EarthError:
        return None
    if area.area_ha < MIN_REGION_HA or area.area_ha > MAX_REGION_HA:
        return None
    day = f" from the {grid.scene_date:%d %b %Y} Sentinel-2 pass" if grid.scene_date else ""
    return DetectBoundaryResponse(
        geometry=area.geojson,
        area_ha=round(area.area_ha, 2),
        confidence=_confidence(grid, poly, mask, area.area_ha),
        method="sentinel2_segmentation",
        note=f"Outline grown{day}; check it against the map.",
    )


def fallback(lat: float, lon: float, why: str) -> DetectBoundaryResponse:
    area = earth.Area.from_geojson(square_geojson(lat, lon, FALLBACK_SIDE_M))
    return DetectBoundaryResponse(
        geometry=area.geojson,
        area_ha=round(area.area_ha, 2),
        confidence="Low",
        method="fallback_square",
        note=f"{why} Drag the corners to fit your field.",
    )


def detect_boundary(lat: float, lon: float) -> DetectBoundaryResponse:
    """The suggested outline for the place at (lat, lon). Never raises for imagery problems."""
    future = _pool.submit(read_indices, lat, lon)
    try:
        grid = future.result(timeout=TIMEOUT_S)
    except FutureTimeout:
        return fallback(lat, lon, "Satellite imagery took too long.")
    except Exception as exc:  # noqa: BLE001 - provider down, no network, odd data: all "no imagery"
        log.warning("detect-boundary: imagery unavailable (%s: %s)", type(exc).__name__, exc)
        return fallback(lat, lon, "No satellite imagery was available here.")
    if grid is None:
        return fallback(lat, lon, "No clear recent satellite pass over this spot.")
    try:
        found = segment(grid, lat, lon)
    except Exception as exc:  # noqa: BLE001
        log.warning("detect-boundary: segmentation failed (%s: %s)", type(exc).__name__, exc)
        found = None
    return found or fallback(lat, lon, "Couldn't tell where the field ends.")
