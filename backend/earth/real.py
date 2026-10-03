"""Real implementation (M1 read, M2 analysis, M9 providers). Selected with EARTH_IMPL=real.

Must provide the same functions as `earth._stub` with the same return types:
describe, scenes, load, index, measure, series, compare, layer_pixels.

M1 (this file): Sentinel-2 L2A optical `scenes`, `load`, `index`, `measure`, `layer_pixels`.
M2 (this file): `describe` (M9a context + recent scene counts), `series` (clearest scene per
period, B11.3 coarse-first), `compare` (clearest scene near each date at 10 m + changed patches).
M9b (this file): Sentinel-1 RTC radar (`kind="radar"`, measure `roughness` = mean VV dB) through
the same functions, pixels from `providers.planetary`; never mixes orbit directions.
Pixels stay in two in-process registries:
  _groups: scene id → providers.earth_search.Group (the STAC items of one pass, tile edges merged)
  _layers: layer id → _Layer (area, scene, items, grid, valid mask, and index values once computed)
Radar layers use the same record: items [] and tiles {}, plus `radar` / `transform` / `raw_db`.
"""

from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeout
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import count
from typing import Any

import numpy as np

from earth import settings
from earth.errors import BudgetExceeded, EarthError, NoClearScenes, WrongSceneKind
from earth.providers import earth_search as es
from earth.providers import planetary as ps
from earth.types import (
    Area,
    BandMonth,
    Comparison,
    LayerRef,
    Measure,
    Patch,
    PlaceContext,
    Provenance,
    Scene,
    SceneCounts,
    SceneKind,
    SceneList,
    Series,
    SeriesPoint,
    Stats,
)

# measure → (index name, band a, band b): value = (a − b) / (a + b)   (HANDOFF B1.4)
INDICES: dict[str, tuple[str, str, str]] = {
    "greenness": ("NDVI", "nir", "red"),
    "moisture": ("NDMI", "nir", "swir16"),
    "water": ("NDWI", "green", "nir"),
    "bare": ("NDBI", "swir16", "nir"),
    "burn": ("NBR", "nir", "swir22"),
}
_MASK_TXT = "SCL mask [" + ",".join(str(c) for c in settings.S2_INVALID_SCL) + "]"
RADAR_MEASURE = "roughness"  # the only radar measure: mean VV backscatter in dB (HANDOFF B1.4)


@dataclass
class _Layer:
    area: Area
    scene: Scene
    items: list[Any]
    gbox: Any
    resolution_m: float
    inside: np.ndarray  # bool, pixel centre inside the area polygon
    valid: np.ndarray  # bool, inside and SCL not in the invalid classes
    cloud: float  # invalid / inside, at this layer's resolution
    tiles: dict[str, int]  # item id → clean pixels it supplied inside the area (tile edges)
    measure: Measure | None = None
    values: np.ndarray | None = None  # float32 index, NaN = masked
    # Radar (M9b) only: the overpass, the UTM affine of the grid (gbox is built from it) and the
    # VV dB pixels read by load(). For optical layers all three stay None.
    radar: ps.RadarScene | None = None
    transform: Any = None
    raw_db: np.ndarray | None = None


_groups: dict[str, es.Group] = {}
_layers: dict[str, _Layer] = {}
_layer_ids = count(1)
_lock = threading.Lock()


def _new_layer_id() -> str:
    with _lock:
        return f"L{next(_layer_ids)}"


def _parse_last(last: str) -> int:
    return int(last[:-1]) * {"d": 1, "w": 7, "m": 30, "y": 365}[last[-1]]


def _scene_from(g: es.Group, cloud: float, clean_px: int, max_cloud: int, res: float) -> Scene:
    return Scene(
        id=g.id,
        date=g.date,
        satellite=g.satellite,
        provider=es.PROVIDER_ID,
        kind="optical",
        cloud_over_area=round(cloud, 4),
        usable=cloud * 100 <= max_cloud and clean_px >= settings.MIN_CLEAN_PX,
        resolution_m=res,
    )


def _cloud(area: Area, scl: np.ndarray, gbox: Any) -> tuple[float, int, np.ndarray, np.ndarray]:
    """(cloud_over_area, clean_px, inside mask, valid mask) from an SCL mosaic."""
    inside = es.area_mask(area, gbox)
    valid = inside & ~np.isin(scl, settings.S2_INVALID_SCL)
    total = int(inside.sum())
    clean = int(valid.sum())
    return (1.0 - clean / total if total else 1.0), clean, inside, valid


# --- public functions ---------------------------------------------------------------------------


def describe(area: Area) -> PlaceContext:
    """Place context (M9a providers) and recent optical scene counts, fetched in parallel."""
    from earth.providers.context import place_context

    pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="describe")
    ctx_f = pool.submit(place_context, area)
    counts_f = pool.submit(_recent_counts, area)
    radar_f = pool.submit(_recent_radar, area)
    t0 = time.monotonic()
    parts = ctx_f.result()  # never raises; slow providers already degraded to warnings
    warnings = list(parts.warnings)
    counts: tuple[int, int] | None = None
    try:
        left = settings.CONTEXT_TIMEOUT_S - (time.monotonic() - t0)
        counts = counts_f.result(timeout=max(left, 1.0))
    except FuturesTimeout:
        warnings.append("Sentinel-2 scene count unavailable: took too long, try again shortly")
    except EarthError as exc:
        warnings.append(f"Sentinel-2 scene count unavailable: {exc.message}")
    radar: int | None = None
    try:
        left = settings.CONTEXT_TIMEOUT_S - (time.monotonic() - t0)
        radar = radar_f.result(timeout=max(left, 1.0))
    except FuturesTimeout:
        warnings.append("Sentinel-1 radar count unavailable: took too long, try again shortly")
    except EarthError as exc:
        warnings.append(f"Sentinel-1 radar count unavailable: {exc.message}")
    pool.shutdown(wait=False)
    warnings += _describe_warnings(area, parts.land_cover, counts, radar)
    optical, clear = counts or (0, 0)
    return PlaceContext(
        name=parts.name,
        country=parts.country,
        area_ha=area.area_ha,
        pixels_10m=area.pixels(10),
        land_cover=parts.land_cover,
        elevation_m=parts.elevation_m,
        slope_deg=parts.slope_deg,
        rain_mm_30d=parts.rain_mm_30d,
        recent_scenes=SceneCounts(optical=optical, clear=clear, radar=radar or 0),
        warnings=warnings,
    )


def scenes(
    area: Area, last: str = "60d", kind: SceneKind = "optical", max_cloud: int = 30
) -> SceneList:
    if kind == "radar":
        end = date.today()
        found = radar_scenes(area, end - timedelta(days=_parse_last(last)), end)
        return SceneList(scenes=[s.to_scene() for s in found], kind="radar", max_cloud=max_cloud)
    end = date.today()
    out = scenes_between(area, end - timedelta(days=_parse_last(last)), end, max_cloud)
    return SceneList(scenes=out, kind="optical", max_cloud=max_cloud)


def scenes_between(area: Area, start: date, end: date, max_cloud: int = 30) -> list[Scene]:
    """Optical scenes over the area with solar day in [start, end], newest first.

    Cloud is computed over the area from SCL at 20 m (or coarser for large areas), all candidate
    passes read in parallel. Internal (M2 `series` / `compare` build on it).
    """
    items = es.search(area, start - timedelta(days=1), end + timedelta(days=1))
    groups = [g for g in es.group(items, area) if start <= g.date <= end]
    return _scan(area, groups, max_cloud)


def _scan(area: Area, groups: list[es.Group], max_cloud: int = 30) -> list[Scene]:
    """Scenes for these passes, cloud over the area from SCL at 20 m, read in parallel."""
    res = es.choose_resolution(area, settings.SCENE_SCAN_RESOLUTION_M)
    gbox = es.geobox(area, res)
    scls = es.read_many([(g.items, ["scl"], gbox) for g in groups])
    out = []
    for g, arrays in zip(groups, scls, strict=True):
        cloud, clean, _, _ = _cloud(area, arrays["scl"], gbox)
        with _lock:
            _groups[g.id] = g
        out.append(_scene_from(g, cloud, clean, max_cloud, res))
    return out


def _find_group(area: Area, scene: Scene) -> es.Group:
    """The scene's items: from the registry, or re-searched by date (scene from another process)."""
    with _lock:
        g = _groups.get(scene.id)
    if g is not None:
        return g
    items = es.search(area, scene.date - timedelta(days=1), scene.date + timedelta(days=2))
    for g in es.group(items, area):
        if scene.id in g.item_ids:
            with _lock:
                _groups[scene.id] = g
            return g
    raise NoClearScenes(
        f"Scene {scene.id} does not cover this area.",
        "Pick a scene from earth.scenes(area) for this same area.",
    )


def load(area: Area, scene: Scene) -> LayerRef:
    if _is_radar(scene):
        return _load_radar(area, scene)
    g = _find_group(area, scene)
    res = es.choose_resolution(area, 10)
    gbox = es.geobox(area, res)
    arrays = es.read(g.items, ["scl"], gbox)
    cloud, clean, inside, valid = _cloud(area, arrays["scl"], gbox)
    src = arrays[es.SOURCE][valid]
    tiles = {it.id: int((src == n).sum()) for n, it in enumerate(g.items)}
    tiles = {k: v for k, v in tiles.items() if v}
    lid = _new_layer_id()
    layer = _Layer(area, scene, g.items, gbox, res, inside, valid, cloud, tiles)
    with _lock:
        _layers[lid] = layer
    return LayerRef(
        id=lid,
        scene=scene.id,
        date=scene.date,
        measure=None,
        resolution_m=res,
        provenance=_prov(layer, "Raw bands", clean),
    )


def _prov(
    layer: _Layer, method: str, clean_px: int, resolution_m: float | None = None
) -> Provenance:
    used = [t.split("_")[1] for t in layer.tiles]
    mosaic = f", mosaic of tiles {'+'.join(used)}" if len(used) > 1 else ""
    return Provenance(
        provider=es.PROVIDER_ID,
        satellite=layer.scene.satellite,
        scene=layer.scene.id,
        date=layer.scene.date,
        cloud_over_area=round(layer.cloud, 4),
        resolution_m=resolution_m or layer.resolution_m,
        method=f"{method}, {_MASK_TXT}, mean over {clean_px} clean pixels{mosaic}",
    )


def _get(layer_id: str) -> _Layer:
    with _lock:
        layer = _layers.get(layer_id)
    if layer is None:
        raise EarthError(
            f"Unknown layer {layer_id!r}.", "Use the LayerRef returned by load() in this run."
        )
    return layer


def index(layer: LayerRef, measure: Measure) -> LayerRef:
    src = _get(layer.id)
    if src.radar is not None:
        return _index_radar(src, measure)
    if measure not in INDICES:  # roughness
        raise WrongSceneKind(
            f"{measure} needs a radar scene, got optical.", 'Use scenes(area, kind="radar").'
        )
    name, a_band, b_band = INDICES[measure]
    bands = es.read(src.items, [a_band, b_band], src.gbox)
    a, b = bands[a_band], bands[b_band]
    with np.errstate(divide="ignore", invalid="ignore"):
        v = (a - b) / (a + b)
    v = np.where(src.valid & np.isfinite(v), np.clip(v, -1, 1), np.nan).astype(np.float32)
    native = max(es.BAND_RES_M[a_band], es.BAND_RES_M[b_band])
    res = max(src.resolution_m, native)
    method = (
        name
        if native <= src.resolution_m
        else f"{name} ({native} m SWIR on a {src.resolution_m:g} m grid)"
    )
    lid = _new_layer_id()
    new = _Layer(
        src.area,
        src.scene,
        src.items,
        src.gbox,
        src.resolution_m,
        src.inside,
        src.valid,
        src.cloud,
        src.tiles,
        measure,
        v,
    )
    with _lock:
        _layers[lid] = new
    return LayerRef(
        id=lid,
        scene=src.scene.id,
        date=src.scene.date,
        measure=measure,
        resolution_m=res,
        provenance=_prov(new, method, int(np.isfinite(v).sum()), res),
    )


def measure(layer: LayerRef) -> Stats:
    src = _get(layer.id)
    if src.measure is None or src.values is None:
        first = RADAR_MEASURE if src.radar is not None else "greenness"
        raise NoClearScenes(
            "This layer has raw bands, not a measure.", f'Call index(layer, "{first}") first.'
        )
    if src.radar is not None:
        return _radar_stats(src, src.values)
    vals = src.values[np.isfinite(src.values)]
    if vals.size == 0:
        raise NoClearScenes(
            f"0 clean pixels over the area on {src.scene.date} (cloud {src.cloud:.0%}).",
            'Pick another scene: scenes(area, last="90d").latest_clear(), or kind="radar".',
        )
    p10, median, p90 = (float(x) for x in np.percentile(vals, [10, 50, 90]))
    name = INDICES[src.measure][0]
    return Stats(
        mean=round(float(vals.mean()), 4),
        median=round(median, 4),
        p10=round(p10, 4),
        p90=round(p90, 4),
        clean_px=int(vals.size),
        cloud=round(src.cloud, 4),
        provenance=_prov(src, name, int(vals.size), layer.resolution_m),
    )


_measure_stats = measure  # `series` / `compare` take a parameter called `measure`


def series(area: Area, measure: Measure, years: int = 5, every: str = "month") -> Series:
    """One clearest scene per period (B11.3: one search, SCL scans then band reads in parallel)."""
    if measure == RADAR_MEASURE:
        return _series_radar(area, years, every)
    today = date.today()
    periods = _periods(today, years, every)
    name, a_band, b_band = INDICES[measure]
    res = es.choose_resolution(area, settings.SERIES_RESOLUTION_M)
    gbox = es.geobox(area, res)
    inside = es.area_mask(area, gbox)
    span = (periods[0][0] - timedelta(days=1), periods[-1][1] + timedelta(days=1))
    by_period = _bucket(es.group(es.search_long(area, *span), area), periods)
    chosen = _clearest_per_period(by_period, gbox, inside, [a_band, b_band])
    missing = [c for c in chosen if c.arrays is None]
    late = _read_parallel([(c.group.items, [a_band, b_band], gbox) for c in missing])
    for c, arr in zip(missing, late, strict=True):
        c.arrays = arr
    bands = [c.arrays for c in chosen]
    points: list[SeriesPoint] = []
    clouds: list[float] = []
    for c, arr in zip(chosen, bands, strict=True):
        value, clean = index_mean(arr[a_band], arr[b_band], c.valid)
        if clean < settings.MIN_CLEAN_PX:
            continue
        with _lock:
            _groups[c.group.id] = c.group
        points.append(
            SeriesPoint(date=c.group.date, value=round(value, 4), scene=c.group.id, clean_px=clean)
        )
        clouds.append(c.cloud)
    if not points:
        raise NoClearScenes(
            f"0 of {len(periods)} periods have a clear Sentinel-2 scene over this area.",
            'Try kind="radar" (Sentinel-1 sees through cloud) or a larger area.',
        )
    cutoff = today - timedelta(days=365)
    band = normal_band(points, cutoff)
    native = max(es.BAND_RES_M[a_band], es.BAND_RES_M[b_band])
    prov = Provenance(
        provider=es.PROVIDER_ID,
        satellite="Sentinel-2",
        scene=f"{len(points)} scenes",
        date=points[-1].date,
        cloud_over_area=round(sum(clouds) / len(clouds), 4),
        resolution_m=max(res, native),
        method=(
            f"{name}, clearest scene per {every} (≤{settings.SERIES_MAX_CLOUD:.0%} cloud over the "
            f"area), {res:g} m, {_MASK_TXT}, mean over clean pixels; {len(points)} of "
            f"{len(periods)} {every}s had a usable scene; normal band from scenes before {cutoff}"
        ),
    )
    return Series(measure=measure, points=points, band=band, provenance=prov)


def compare(area: Area, measure: Measure, before: date, after: date) -> Comparison:
    """Clearest scene near each date, both read at 10 m on one grid, plus changed patches."""
    if measure == RADAR_MEASURE:
        return _compare_radar(area, before, after)
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="compare") as pool:
        s_before, s_after = pool.map(lambda d: _scene_near(area, d), (before, after))
        if s_before.id == s_after.id:
            raise NoClearScenes(
                f"The same scene ({s_before.date}) is the clearest one near both dates.",
                "Pick dates further apart (more than ~6 weeks).",
            )
        l_before, l_after = pool.map(lambda s: index(load(area, s), measure), (s_before, s_after))
    st_before, st_after = _measure_stats(l_before), _measure_stats(l_after)
    lb, la = _get(l_before.id), _get(l_after.id)
    delta = round(st_after.mean - st_before.mean, 4)
    patches, changed_ha = change_patches(
        la.values - lb.values,  # type: ignore[operator]
        delta,
        settings.CHANGE_THRESHOLDS[measure],
        la.gbox,
    )
    return Comparison(
        measure=measure,
        before=st_before,
        after=st_after,
        delta=delta,
        changed_ha=min(changed_ha, round(area.area_ha, 2)),
        patches=patches,
        provenance=st_after.provenance,
    )


def layer_tiles(layer_id: str) -> dict[str, int]:
    """Item id → clean pixels it supplied inside the area (more than one = tile-edge mosaic)."""
    return dict(_get(layer_id).tiles)


def layer_pixels(layer_id: str) -> tuple[np.ndarray, tuple[float, float, float, float]]:
    """2-D float array (NaN = masked) of the layer's measure, and its WGS84 bounds."""
    src = _get(layer_id)
    if src.values is None:
        first = RADAR_MEASURE if src.radar is not None else "greenness"
        raise NoClearScenes(
            "Raw band layers can't be rendered yet.", f'Call index(layer, "{first}") first.'
        )
    if src.radar is not None:
        return src.values, ps.grid_bounds(src.area, src.values.shape, src.transform)
    return src.values, es.wgs84_bounds(src.gbox)


# --- M2 helpers: describe -------------------------------------------------------------------------


def _recent_counts(area: Area) -> tuple[int, int]:
    """(optical scenes, clear ones) over the area in the last DESCRIBE_LAST_DAYS days."""
    end = date.today()
    found = scenes_between(area, end - timedelta(days=settings.DESCRIBE_LAST_DAYS), end)
    return len(found), sum(s.usable for s in found)


def _describe_warnings(
    area: Area,
    land_cover: dict[str, float],
    counts: tuple[int, int] | None,
    radar: int | None = None,
) -> list[str]:
    out = []
    if area.pixels(10) < settings.MIN_PIXELS_10M:
        out.append(
            f"area {area.area_ha:.2f} ha ≈ {area.pixels(10)} pixels at 10 m: too small to measure "
            "(load / series / compare will refuse); enlarge the area"
        )
    elif area.area_ha < 1:
        out.append(f"area {area.area_ha:.2f} ha: changes under ~20 m are invisible at 10 m")
    if area.area_ha > settings.MAX_AREA_HA:
        out.append(
            f"area {area.area_ha:.0f} ha is above the {settings.MAX_AREA_HA} ha limit: "
            "draw a smaller outline before measuring"
        )
    water = land_cover.get("water", 0.0)
    if water >= 0.5:
        out.append(
            f"mostly open water ({water:.0%} by land cover, ESA WorldCover 2021): greenness is "
            'low over water, so check "water" alongside greenness and bare'
        )
    days = settings.DESCRIBE_LAST_DAYS
    if counts is None:
        return out
    optical, clear = counts
    passes = f"{radar} Sentinel-1 radar passes in that window, " if radar else ""
    if optical == 0:
        out.append(
            f"no Sentinel-2 scenes over the area in the last {days} days; {passes}"
            'radar sees through cloud: scenes(area, kind="radar") with measure "roughness"'
        )
    elif clear == 0:
        out.append(
            f"0 of {optical} Sentinel-2 scenes in the last {days} days are clear over the area "
            f"(cloud): use a longer window, or radar ({passes}sees through cloud): "
            'scenes(area, kind="radar") with measure "roughness"'
        )
    return out


# --- M2 helpers: series ---------------------------------------------------------------------------

_STEP_MONTHS = {"month": 1, "quarter": 3, "year": 12}


def _periods(today: date, years: int, every: str) -> list[tuple[date, date]]:
    """Calendar periods (start, end) oldest first, the last one containing today."""
    step = _STEP_MONTHS.get(every)
    if step is None:
        raise EarthError(f"every={every!r} is not supported.", 'Use "month" | "quarter" | "year".')
    if not isinstance(years, int) or years < 1:
        raise EarthError(f"years={years!r} must be a whole number ≥ 1.", "Try years=5.")
    n = years * 12 // step
    if n > settings.MAX_SERIES_SCENES:
        raise BudgetExceeded(
            f"{n} scenes requested, max {settings.MAX_SERIES_SCENES}.",
            f'Try every="quarter" or years={settings.MAX_SERIES_SCENES * step // 12}.',
        )
    cur = (today.year * 12 + today.month - 1) // step
    out = []
    for k in range(cur - n + 1, cur + 1):
        m0, m1 = k * step, (k + 1) * step
        start = date(m0 // 12, m0 % 12 + 1, 1)
        end = date(m1 // 12, m1 % 12 + 1, 1) - timedelta(days=1)
        out.append((start, min(end, today)))
    return out


def _tile_cloud(g: es.Group) -> float:
    cc = g.items[0].properties.get("eo:cloud_cover")
    return float(cc) if cc is not None else 50.0


def _bucket(groups: list[es.Group], periods: list[tuple[date, date]]) -> list[list[es.Group]]:
    """Passes per period, least tile-cloudy first (a cheap prior for the SCL scan order)."""
    out: list[list[es.Group]] = [[] for _ in periods]
    for g in groups:
        for i, (start, end) in enumerate(periods):
            if start <= g.date <= end:
                out[i].append(g)
                break
    for gs in out:
        gs.sort(key=lambda g: (_tile_cloud(g), g.date))
    return out


@dataclass
class _Pick:
    group: es.Group
    cloud: float
    clean: int
    valid: np.ndarray
    arrays: dict[str, np.ndarray] | None = None  # index bands, if read along with SCL


def _read_parallel(jobs: list[tuple[list[Any], list[str], Any]]) -> list[dict[str, np.ndarray]]:
    if len(jobs) <= 1:
        return [es.read(*j) for j in jobs]
    with ThreadPoolExecutor(max_workers=settings.SERIES_READ_THREADS) as pool:
        return list(pool.map(lambda j: es.read(*j), jobs))


def _clearest_per_period(
    by_period: list[list[es.Group]], gbox: Any, inside: np.ndarray, bands: list[str]
) -> list[_Pick]:
    """Scans in rounds: periods without a good scene yet get their next candidates.

    Round 1 reads SCL and the index bands together (the least tile-cloudy pass is usually the
    one kept); later rounds read SCL only and the winner's bands are read afterwards.
    """
    total = int(inside.sum())
    scanned: list[list[_Pick]] = [[] for _ in by_period]
    pos = [0] * len(by_period)
    for take in settings.SERIES_SCAN_ROUNDS:
        jobs: list[tuple[int, es.Group]] = []
        for i, cands in enumerate(by_period):
            if any(p.cloud <= settings.SERIES_GOOD_CLOUD for p in scanned[i]):
                continue
            jobs += [(i, g) for g in cands[pos[i] : pos[i] + take]]
            pos[i] += take
        if not jobs:
            break
        want = ["scl", *bands] if take == settings.SERIES_SCAN_ROUNDS[0] else ["scl"]
        reads = _read_parallel([(g.items, want, gbox) for _, g in jobs])
        for (i, g), arr in zip(jobs, reads, strict=True):
            valid = inside & ~np.isin(arr["scl"], settings.S2_INVALID_SCL)
            clean = int(valid.sum())
            cloud = 1.0 - clean / total if total else 1.0
            scanned[i].append(_Pick(g, cloud, clean, valid, arr if len(want) > 1 else None))
    return [p for p in (pick_clearest(s) for s in scanned) if p is not None]


def pick_clearest(cands: list[_Pick]) -> _Pick | None:
    """The least cloudy usable candidate (cloud ≤ SERIES_MAX_CLOUD, enough clean pixels)."""
    ok = [
        p
        for p in cands
        if p.cloud <= settings.SERIES_MAX_CLOUD and p.clean >= settings.MIN_CLEAN_PX
    ]
    return min(ok, key=lambda p: (p.cloud, -p.clean, p.group.date), default=None)


def index_mean(a: np.ndarray, b: np.ndarray, valid: np.ndarray) -> tuple[float, int]:
    """Mean of (a − b) / (a + b) over valid, finite pixels, and how many there were."""
    with np.errstate(divide="ignore", invalid="ignore"):
        v = (a - b) / (a + b)
    ok = valid & np.isfinite(v)
    n = int(ok.sum())
    return (float(np.clip(v[ok], -1, 1).mean()) if n else float("nan")), n


def normal_band(points: list[SeriesPoint], cutoff: date) -> list[BandMonth]:
    """Per calendar month: lo / hi / mean of points before `cutoff`, if ≥ N distinct years."""
    by_month: dict[int, list[SeriesPoint]] = {}
    for p in points:
        if p.date < cutoff:
            by_month.setdefault(p.date.month, []).append(p)
    out = []
    for month in sorted(by_month):
        ps = by_month[month]
        if len({p.date.year for p in ps}) < settings.SERIES_NORMAL_MIN_YEARS:
            continue
        vals = [p.value for p in ps]
        out.append(
            BandMonth(
                month=month,
                lo=round(min(vals), 4),
                hi=round(max(vals), 4),
                mean=round(sum(vals) / len(vals), 4),
            )
        )
    return out


# --- M2 helpers: compare --------------------------------------------------------------------------


def _scene_near(area: Area, d: date) -> Scene:
    """The scene for date `d`: within ±COMPARE_WINDOW_DAYS first, then ±COMPARE_WIDE_WINDOW_DAYS."""
    narrow, wide = settings.COMPARE_WINDOW_DAYS, settings.COMPARE_WIDE_WINDOW_DAYS
    items = es.search(area, d - timedelta(days=wide + 1), d + timedelta(days=wide + 1))
    groups = es.group(items, area)
    max_cloud = round(settings.COMPARE_MAX_CLOUD * 100)
    seen: list[Scene] = []
    for lo, hi in ((0, narrow), (narrow + 1, wide)):
        ring = [g for g in groups if lo <= abs((g.date - d).days) <= hi]
        seen += _scan(area, ring, max_cloud)
        best = closest_clear(seen, d)
        if best is not None:
            return best
    # Last resort: the least cloudy partly-cloudy scene. Masked pixels are left out of every
    # number and Stats.cloud / provenance report the cloud, so this stays honest.
    partly = [
        s
        for s in seen
        if s.cloud_over_area <= settings.COMPARE_FALLBACK_CLOUD
        and _clean_px(area, s) >= settings.MIN_CLEAN_PX
    ]
    if partly:
        return min(partly, key=lambda s: (s.cloud_over_area, abs((s.date - d).days)))
    span = (
        f", cloud over the area {min(s.cloud_over_area for s in seen):.0%}–"
        f"{max(s.cloud_over_area for s in seen):.0%}"
        if seen
        else ""
    )
    raise NoClearScenes(
        f"0 of {len(seen)} Sentinel-2 scenes within ±{wide} days of {d} are clear over the "
        f"area{span}.",
        'scenes(area, kind="radar") (Sentinel-1 sees through cloud), or other dates from '
        'scenes(area, last="1y").clear().',
    )


def _clean_px(area: Area, s: Scene) -> int:
    """Approximate clean pixels of a scanned scene at its scan resolution."""
    return int(area.pixels(s.resolution_m) * (1 - s.cloud_over_area))


def closest_clear(found: list[Scene], d: date) -> Scene | None:
    """Closest usable scene to `d`; a clear one (≤ COMPARE_GOOD_CLOUD) beats a cloudier one."""
    usable = [s for s in found if s.usable]
    good = [s for s in usable if s.cloud_over_area <= settings.COMPARE_GOOD_CLOUD] or usable
    return min(good, key=lambda s: (abs((s.date - d).days), s.cloud_over_area), default=None)


def majority3(mask: np.ndarray) -> np.ndarray:
    """3×3 majority filter (≥ 5 of 9): drops speckle and fills pinholes."""
    h, w = mask.shape
    p = np.pad(mask.astype(np.uint8), 1)
    votes = sum(p[i : i + h, j : j + w] for i in range(3) for j in range(3))
    return votes >= 5


def change_patches(
    diff: np.ndarray, delta: float, threshold: float, gbox: Any
) -> tuple[list[Patch], float]:
    """Patches where after − before moved ≥ threshold in the direction of the mean change.

    `diff` is NaN where either side is masked. Returns (largest MAX_PATCHES patches, total ha of
    all patches ≥ MIN_PATCH_HA).
    """
    from pyproj import Transformer
    from rasterio.features import shapes
    from shapely.geometry import mapping, shape
    from shapely.ops import transform

    sign = 1.0 if delta >= 0 else -1.0
    with np.errstate(invalid="ignore"):
        hit = np.isfinite(diff) & (diff * sign >= threshold)
    hit = majority3(hit)
    if not hit.any():
        return [], 0.0
    back = Transformer.from_crs(str(gbox.crs), "EPSG:4326", always_xy=True).transform
    res = abs(gbox.transform.a)
    found = []
    for geom, _ in shapes(hit.astype(np.uint8), mask=hit, transform=gbox.transform, connectivity=8):
        poly = shape(geom)
        ha = poly.area / 10_000
        if ha >= settings.MIN_PATCH_HA:
            found.append((ha, poly))
    found.sort(key=lambda x: -x[0])
    patches = []
    for ha, poly in found[: settings.MAX_PATCHES]:
        wgs = transform(back, poly.simplify(res / 2, preserve_topology=True))
        c = transform(back, poly.centroid)
        patches.append(
            Patch(
                ha=round(ha, 2),
                centroid=(round(c.y, 6), round(c.x, 6)),
                geojson=json.loads(json.dumps(mapping(wgs))),
            )
        )
    return patches, round(sum(ha for ha, _ in found), 2)


# --- M9b: Sentinel-1 radar (roughness = mean VV backscatter, dB) ---------------------------------


def _is_radar(scene: Scene) -> bool:
    return scene.kind == "radar" or scene.provider == ps.S1_PROVIDER


def radar_scenes(area: Area, start: date, end: date) -> list[ps.RadarScene]:
    """Sentinel-1 passes over the area in [start, end], newest first.

    Windows longer than S1_SEARCH_CHUNK_DAYS are searched in parallel chunks: one STAC search
    returns at most 500 items, and a multi-year window over 2+ tracks has more slices than that.
    """
    chunks: list[tuple[date, date]] = []
    s = start
    while s <= end:
        e = min(s + timedelta(days=settings.S1_SEARCH_CHUNK_DAYS - 1), end)
        chunks.append((s, e))
        s = e + timedelta(days=1)
    if len(chunks) <= 1:
        return ps.search_s1(area, start, end)
    with ThreadPoolExecutor(max_workers=min(len(chunks), 8), thread_name_prefix="s1search") as p:
        parts = list(p.map(lambda c: ps.search_s1(area, *c), chunks))
    seen: dict[str, ps.RadarScene] = {}
    for part in parts:
        for sc in part:
            seen.setdefault(sc.id, sc)
    return sorted(seen.values(), key=lambda sc: (sc.date, sc.id), reverse=True)


def _recent_radar(area: Area) -> int:
    end = date.today()
    return len(ps.search_s1(area, end - timedelta(days=settings.DESCRIBE_LAST_DAYS), end))


def _radar_layer(
    area: Area, rs: ps.RadarScene, db: np.ndarray, tr: Any, measure: Measure | None = None
) -> tuple[str, _Layer]:
    """Register a radar layer: same record as optical, items [] / tiles {} / cloud 0."""
    from odc.geo.geobox import GeoBox

    layer = _Layer(
        area=area,
        scene=rs.to_scene(),
        items=[],
        gbox=GeoBox(db.shape, tr, f"EPSG:{area.utm_epsg()}"),
        resolution_m=float(abs(tr.a)),
        inside=ps._polygon_mask(area, db.shape, tr),
        valid=np.isfinite(db),
        cloud=0.0,
        tiles={},
        measure=measure,
        values=db.astype(np.float32) if measure else None,
        radar=rs,
        transform=tr,
        raw_db=db,
    )
    lid = _new_layer_id()
    with _lock:
        _layers[lid] = layer
    return lid, layer


def _radar_stats(layer: _Layer, db: np.ndarray) -> Stats:
    """roughness_stats over this layer's pixels, with the layer's real grid resolution."""
    st = ps.roughness_stats(layer.area, layer.radar, "vv", db=np.asarray(db, dtype="float64"))
    prov = st.provenance.model_copy(update={"resolution_m": layer.resolution_m})
    return st.model_copy(update={"provenance": prov})


def _load_radar(area: Area, scene: Scene) -> LayerRef:
    rs = ps.resolve_scene(area, scene)
    db, tr = ps.read_s1(area, rs, "vv")
    lid, layer = _radar_layer(area, rs, db, tr)
    prov = _radar_stats(layer, db).provenance
    return LayerRef(
        id=lid,
        scene=rs.id,
        date=rs.date,
        measure=None,
        resolution_m=layer.resolution_m,
        provenance=prov.model_copy(update={"method": f"Raw VV, {prov.method}"}),
    )


def _index_radar(src: _Layer, measure: Measure) -> LayerRef:
    if measure != RADAR_MEASURE:
        raise WrongSceneKind(
            f"{measure} needs an optical scene, got radar.",
            'Use scenes(area, kind="optical") for greenness / moisture / water / bare / burn; '
            'a radar layer only gives index(layer, "roughness").',
        )
    assert src.radar is not None and src.raw_db is not None
    lid, new = _radar_layer(src.area, src.radar, src.raw_db, src.transform, RADAR_MEASURE)
    return LayerRef(
        id=lid,
        scene=new.scene.id,
        date=new.scene.date,
        measure=RADAR_MEASURE,
        resolution_m=new.resolution_m,
        provenance=_radar_stats(new, src.raw_db).provenance,
    )


def _radar_mean(area: Area, rs: ps.RadarScene, res: float) -> tuple[float, int] | None:
    """(mean VV dB, valid px) of one pass, or None if it fails or covers too little of the area."""
    try:
        db, tr = ps.read_s1(area, rs, "vv", resolution_m=res)
    except Exception:  # noqa: BLE001 — one failed pass only leaves its period empty
        return None
    ok = np.isfinite(db)
    n, inside = int(ok.sum()), int(ps._polygon_mask(area, db.shape, tr).sum())
    if n < settings.MIN_CLEAN_PX or (inside and n / inside < settings.S1_MIN_COVERAGE):
        return None
    return float(db[ok].mean()), n


def _main_track(scenes: list[ps.RadarScene], periods: list[tuple[date, date]]) -> int | None:
    """The relative orbit that covers the most periods (ties: more passes, lower number)."""
    cover: dict[int | None, set[int]] = {}
    passes: dict[int | None, int] = {}
    for sc in scenes:
        passes[sc.relative_orbit] = passes.get(sc.relative_orbit, 0) + 1
        for i, (a, b) in enumerate(periods):
            if a <= sc.date <= b:
                cover.setdefault(sc.relative_orbit, set()).add(i)
                break
    if not cover:
        return None
    return max(cover, key=lambda r: (len(cover[r]), passes[r], -(r or 0)))


def _series_radar(area: Area, years: int, every: str) -> Series:
    """One pass per period: one orbit direction for the whole series, one track preferred."""
    today = date.today()
    periods = _periods(today, years, every)
    found = radar_scenes(area, periods[0][0], periods[-1][1])
    if not found:
        raise NoClearScenes(
            f"No Sentinel-1 radar passes over this area in the last {years} year(s).",
            'Radar coverage has gaps in some regions; use an optical measure like "greenness".',
        )
    direction = ps.same_orbit(found)
    state = direction[0].orbit_state
    track = _main_track(direction, periods)
    # Candidates per period: main track first, then nearest to mid-period.
    cands: list[list[ps.RadarScene]] = []
    for a, b in periods:
        mid = a + (b - a) / 2
        here = [sc for sc in direction if a <= sc.date <= b]
        here.sort(key=lambda sc: (sc.relative_orbit != track, abs((sc.date - mid).days), sc.id))
        cands.append(here)
    res = float(settings.S1_SERIES_RESOLUTION_M)
    chosen: dict[int, tuple[ps.RadarScene, float, int]] = {}
    deadline = time.monotonic() + settings.S1_SERIES_DEADLINE_S
    for k in range(settings.S1_SERIES_TRIES):
        jobs = [(i, c[k]) for i, c in enumerate(cands) if i not in chosen and len(c) > k]
        left = deadline - time.monotonic()
        if not jobs or left <= 0:
            break
        pool = ThreadPoolExecutor(max_workers=settings.S1_SERIES_THREADS)
        futs = {pool.submit(_radar_mean, area, sc, res): (i, sc) for i, sc in jobs}
        try:
            for f in as_completed(futs, timeout=left):
                if (r := f.result()) is not None:
                    i, sc = futs[f]
                    chosen[i] = (sc, *r)
        except FuturesTimeout:
            pass  # slow reads past the deadline: those periods stay empty (provenance counts)
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
    if not chosen:
        raise NoClearScenes(
            f"0 of {len(periods)} periods have a usable Sentinel-1 pass over this area.",
            "Passes may only clip the area's edge; try a larger area or an optical measure.",
        )
    picks = [chosen[i] for i in sorted(chosen)]
    points = [
        SeriesPoint(date=sc.date, value=round(v, 2), scene=sc.id, clean_px=n) for sc, v, n in picks
    ]
    on_track = sum(sc.relative_orbit == track for sc, _, _ in picks)
    track_txt = (
        f"relative orbit {track}"
        if on_track == len(picks)
        else f"relative orbit {track} for {on_track} of {len(picks)} points, other {state} "
        "tracks for the rest"
    )
    cutoff = today - timedelta(days=365)
    prov = Provenance(
        provider=ps.S1_PROVIDER,
        satellite="Sentinel-1",
        scene=f"{len(points)} scenes",
        date=points[-1].date,
        cloud_over_area=0.0,
        resolution_m=res,
        method=(
            f"VV dB, {state} orbit only ({track_txt}): mean VV backscatter (dB), RTC gamma0, "
            f"3x3 speckle filter, one pass per {every} nearest mid-{every}, {res:g} m; "
            f"{len(points)} of {len(periods)} {every}s had a pass; normal band from scenes "
            f"before {cutoff}"
        ),
    )
    return Series(
        measure=RADAR_MEASURE, points=points, band=normal_band(points, cutoff), provenance=prov
    )


def radar_pair(
    near_before: list[ps.RadarScene], near_after: list[ps.RadarScene], before: date, after: date
) -> tuple[ps.RadarScene, ps.RadarScene] | None:
    """The closest (before, after) passes of the SAME orbit direction, same track preferred.

    Never pairs ascending with descending (several dB apart from viewing geometry alone).
    """

    def best(pool_b: list[ps.RadarScene], pool_a: list[ps.RadarScene]):
        out = None
        for sb in pool_b:
            for sa in pool_a:
                if sa.date <= sb.date:
                    continue
                key = (abs((sb.date - before).days) + abs((sa.date - after).days), sb.id, sa.id)
                if out is None or key < out[0]:
                    out = (key, sb, sa)
        return out

    same_track, same_dir = [], []
    for state in sorted({sc.orbit_state for sc in near_before}):
        b_dir = [sc for sc in near_before if sc.orbit_state == state]
        a_dir = [sc for sc in near_after if sc.orbit_state == state]
        if (hit := best(b_dir, a_dir)) is not None:
            same_dir.append(hit)
        for rel in {sc.relative_orbit for sc in b_dir}:
            hit = best(
                [sc for sc in b_dir if sc.relative_orbit == rel],
                [sc for sc in a_dir if sc.relative_orbit == rel],
            )
            if hit is not None:
                same_track.append(hit)
    pick = min(same_track or same_dir, default=None, key=lambda h: h[0])
    return None if pick is None else (pick[1], pick[2])


def _compare_radar(area: Area, before: date, after: date) -> Comparison:
    w = timedelta(days=settings.S1_COMPARE_WINDOW_DAYS)
    today = date.today()
    if after - w > today:
        raise EarthError(f"{after} is in the future.", "Use dates up to today.")
    windows = [(d - w, min(d + w, today)) for d in (before, after)]
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="compare-s1") as pool:
        near_b, near_a = pool.map(lambda win: ps.search_s1(area, *win), windows)
    pair = radar_pair(near_b, near_a, before, after)
    if pair is None:
        dirs_b = ", ".join(sorted({sc.orbit_state for sc in near_b})) or "none"
        dirs_a = ", ".join(sorted({sc.orbit_state for sc in near_a})) or "none"
        raise EarthError(
            f"No Sentinel-1 passes of the same orbit direction within ±{w.days} days of both "
            f"{before} ({len(near_b)} passes: {dirs_b}) and {after} ({len(near_a)} passes: "
            f"{dirs_a}).",
            'Pick other dates from scenes(area, kind="radar", last="1y") with the same orbit '
            "direction, or compare an optical measure.",
        )
    sb, sa = pair
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="compare-s1") as pool:
        l_before, l_after = pool.map(
            lambda sc: index(load(area, sc.to_scene()), RADAR_MEASURE), (sb, sa)
        )
    lb, la = _get(l_before.id), _get(l_after.id)
    assert lb.values is not None and la.values is not None
    if lb.values.shape != la.values.shape:
        raise EarthError(
            "The two radar passes came back on different grids.",
            "Retry; if it persists, pick other dates.",
        )
    st_before, st_after = _radar_stats(lb, lb.values), _radar_stats(la, la.values)
    delta = round(st_after.mean - st_before.mean, 2)
    patches, changed_ha = change_patches(
        la.values - lb.values, delta, settings.S1_CHANGE_THRESHOLD_DB, la.gbox
    )
    track = (
        f"same relative orbit {sa.relative_orbit}"
        if sa.relative_orbit == sb.relative_orbit
        else f"relative orbits {sb.relative_orbit} → {sa.relative_orbit}"
    )
    prov = st_after.provenance.model_copy(
        update={
            "method": (
                f"{st_after.provenance.method}; before = {sb.id}, same {sa.orbit_state} orbit, "
                f"{track}; changed patches where VV moved ≥ "
                f"{settings.S1_CHANGE_THRESHOLD_DB:g} dB"
            )
        }
    )
    return Comparison(
        measure=RADAR_MEASURE,
        before=st_before,
        after=st_after,
        delta=delta,
        changed_ha=min(changed_ha, round(area.area_ha, 2)),
        patches=patches,
        provenance=prov,
    )
