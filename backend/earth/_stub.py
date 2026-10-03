"""Stub implementation: Hoo Hok Wai preset numbers (HANDOFF B12.2) for any area, no network.

Shape-faithful to the real implementation so the agent, runner and frontend can be built
against it. Any area gets the Hoo Hok Wai story; the `surroundings()` ring gets the stable
regional values, so "local, not regional" reproduces.
"""

from __future__ import annotations

import math
import zlib
from datetime import date, timedelta
from itertools import count

import numpy as np

from earth import settings
from earth.errors import BudgetExceeded, NoClearScenes, WrongSceneKind
from earth.providers.nominatim import PlaceHit
from earth.providers.openmeteo import RainDay, RainSeries, window_days
from earth.types import (
    Area,
    BandMonth,
    Comparison,
    LayerRef,
    Measure,
    Patch,
    PlaceContext,
    Provenance,
    Range,
    Scene,
    SceneCounts,
    SceneKind,
    SceneList,
    Series,
    SeriesPoint,
    SlopeStats,
    Stats,
)

TODAY = date(2026, 9, 30)
TILE = "49QHE"
FILL_START = date(2025, 1, 1)

# (before filling, after filling) inside the ponds, and the stable surroundings value
_LEVELS: dict[str, tuple[float, float, float]] = {
    "greenness": (0.44, 0.02, 0.55),
    "moisture": (0.25, -0.05, 0.30),
    "water": (0.10, -0.25, -0.30),
    "bare": (-0.35, 0.10, -0.30),
    "burn": (0.35, -0.05, 0.40),
    "roughness": (-8.5, -10.7, -7.3),
}
# Exact values measured by Friday's prototype
_EXACT: dict[tuple[str, date], float] = {
    ("greenness", date(2026, 9, 25)): 0.063,
    ("greenness", date(2026, 9, 30)): -0.013,
    ("bare", date(2026, 9, 30)): 0.12,
    ("roughness", date(2026, 9, 28)): -10.71,
}
_METHOD = {
    "greenness": "NDVI",
    "moisture": "NDMI",
    "water": "NDWI",
    "bare": "NDBI",
    "burn": "NBR",
    "roughness": "Mean VV backscatter (dB), same orbit direction",
}

_layers: dict[str, tuple[Area, Scene, Measure | None]] = {}
_layer_ids = count(1)


# --- preset curves ------------------------------------------------------------------------------


def _progress(d: date) -> float:
    """0 before filling started, 1 when the ponds are fully filled (30 Sep 2026)."""
    if d <= FILL_START:
        return 0.0
    if d >= TODAY:
        return 1.0
    return ((d - FILL_START).days / (TODAY - FILL_START).days) ** 1.6


def _value(measure: Measure, d: date, ring: bool) -> float:
    pre, post, around = _LEVELS[measure]
    seasonal = 0.04 * math.sin(2 * math.pi * (d.timetuple().tm_yday - 100) / 365)
    if measure == "roughness":
        seasonal *= 5
    if ring:
        return round(around + seasonal, 3)
    if (measure, d) in _EXACT:
        return _EXACT[(measure, d)]
    p = _progress(d)
    return round(pre + (post - pre) * p + seasonal * (1 - p), 3)


def _cloud(d: date) -> float:
    """Deterministic cloud over the area: about a third of passes are cloudy."""
    return round([0.02, 0.04, 0.71, 0.0, 0.43, 0.08, 0.01, 0.92, 0.05][d.toordinal() % 9], 2)


def _optical_scene(d: date, max_cloud: int = 30) -> Scene:
    sat = "Sentinel-2B" if d.toordinal() % 2 else "Sentinel-2A"
    cloud = 0.03 if d in {s for (_, s) in _EXACT} else _cloud(d)
    return Scene(
        id=f"S2{sat[-1]}_{TILE}_{d:%Y%m%d}_0_L2A",
        date=d,
        satellite=sat,
        provider="earth_search_s2",
        kind="optical",
        cloud_over_area=cloud,
        usable=cloud * 100 <= max_cloud,
        resolution_m=10,
    )


def _radar_scene(d: date) -> Scene:
    return Scene(
        id=f"S1A_IW_GRDH_1SDV_{d:%Y%m%d}_rtc",
        date=d,
        satellite="Sentinel-1A",
        provider="planetary_s1_rtc",
        kind="radar",
        cloud_over_area=0.0,
        usable=True,
        resolution_m=10,
    )


def _prov(scene: Scene, measure: Measure | None, clean_px: int) -> Provenance:
    method = _METHOD.get(measure or "", "Raw bands")
    if scene.kind == "optical":
        method += ", SCL mask [0,1,3,8,9,10]"
    return Provenance(
        provider=scene.provider,
        satellite=scene.satellite,
        scene=scene.id,
        date=scene.date,
        cloud_over_area=scene.cloud_over_area,
        resolution_m=scene.resolution_m,
        method=f"{method}, mean over {clean_px} clean pixels (stub)",
    )


def _parse_last(last: str) -> int:
    unit = last[-1]
    n = int(last[:-1])
    return n * {"d": 1, "w": 7, "m": 30, "y": 365}[unit]


# --- public functions ---------------------------------------------------------------------------


def describe(area: Area) -> PlaceContext:
    optical = scenes(area, last="60d")
    radar = scenes(area, last="60d", kind="radar")
    warnings = []
    if area.area_ha < 1:
        warnings.append(f"area {area.area_ha:.2f} ha: changes under ~20 m are invisible at 10 m")
    return PlaceContext(
        name=area.name or "Hoo Hok Wai",
        country="Hong Kong",
        area_ha=area.area_ha,
        pixels_10m=area.pixels(10),
        land_cover={"water": 0.34, "grassland": 0.26, "bare": 0.2, "trees": 0.12, "built": 0.08},
        elevation_m=Range(min=1, max=6),
        slope_deg=SlopeStats(mean=1.2, p90=3.1),
        rain_mm_30d=212.4,
        recent_scenes=SceneCounts(
            optical=len(optical.scenes), clear=len(optical.clear()), radar=len(radar.scenes)
        ),
        warnings=warnings,
    )


def scenes(
    area: Area, last: str = "60d", kind: SceneKind = "optical", max_cloud: int = 30
) -> SceneList:
    start = TODAY - timedelta(days=_parse_last(last))
    step = 5 if kind == "optical" else 12
    out: list[Scene] = []
    d = TODAY if kind == "optical" else date(2026, 9, 28)
    while d >= start:
        out.append(_optical_scene(d, max_cloud) if kind == "optical" else _radar_scene(d))
        d -= timedelta(days=step)
    if kind == "optical":  # the prototype's 25 Sep pass
        out.insert(1, _optical_scene(date(2026, 9, 25), max_cloud))
    return SceneList(scenes=out, kind=kind, max_cloud=max_cloud)


def load(area: Area, scene: Scene) -> LayerRef:
    lid = f"L{next(_layer_ids)}"
    _layers[lid] = (area, scene, None)
    return LayerRef(
        id=lid,
        scene=scene.id,
        date=scene.date,
        measure=None,
        resolution_m=scene.resolution_m,
        provenance=_prov(scene, None, area.pixels(scene.resolution_m)),
    )


def index(layer: LayerRef, measure: Measure) -> LayerRef:
    area, scene, _ = _layers[layer.id]
    if (measure == "roughness") != (scene.kind == "radar"):
        raise WrongSceneKind(
            f"{measure} needs {'a radar' if measure == 'roughness' else 'an optical'} scene, "
            f"got {scene.kind}.",
            f'Use scenes(area, kind="{"radar" if measure == "roughness" else "optical"}").',
        )
    lid = f"L{next(_layer_ids)}"
    _layers[lid] = (area, scene, measure)
    res = 20 if measure in ("moisture", "bare", "burn") else 10
    clean = int(area.pixels(res) * (1 - scene.cloud_over_area))
    return LayerRef(
        id=lid,
        scene=scene.id,
        date=scene.date,
        measure=measure,
        resolution_m=res,
        provenance=_prov(scene, measure, clean),
    )


def measure(layer: LayerRef) -> Stats:
    area, scene, m = _layers[layer.id]
    if m is None:
        raise NoClearScenes(
            "This layer has raw bands, not a measure.", 'Call index(layer, "greenness") first.'
        )
    mean = _value(m, scene.date, area.is_ring())
    spread = 1.5 if m == "roughness" else 0.12
    clean = int(area.pixels(layer.resolution_m) * (1 - scene.cloud_over_area))
    return Stats(
        mean=mean,
        median=round(mean + spread * 0.05, 3),
        p10=round(mean - spread, 3),
        p90=round(mean + spread, 3),
        clean_px=clean,
        cloud=scene.cloud_over_area,
        provenance=_prov(scene, m, clean),
    )


_stats = measure  # `compare` takes a parameter called `measure`


def series(area: Area, measure: Measure, years: int = 5, every: str = "month") -> Series:
    step_months = {"month": 1, "quarter": 3, "year": 12}.get(every)
    if step_months is None:
        raise BudgetExceeded(
            f'every="{every}" is not supported.', 'Use every="month" or "quarter".'
        )
    n = years * 12 // step_months
    if n > settings.MAX_SERIES_SCENES:
        raise BudgetExceeded(
            f"{n} scenes requested, max {settings.MAX_SERIES_SCENES}.",
            f'Try every="quarter" or years={settings.MAX_SERIES_SCENES * step_months // 12}.',
        )
    ring = area.is_ring()
    points: list[SeriesPoint] = []
    for i in range(n - 1, -1, -1):
        months_back = i * step_months
        y, m = divmod(TODAY.year * 12 + TODAY.month - 1 - months_back, 12)
        d = TODAY if months_back == 0 else date(y, m + 1, 14)
        scene = (_radar_scene if measure == "roughness" else _optical_scene)(d)
        points.append(
            SeriesPoint(
                date=d,
                value=_value(measure, d, ring),
                scene=scene.id,
                clean_px=int(area.pixels(20) * (1 - min(scene.cloud_over_area, 0.3))),
            )
        )
    baseline = [p for p in points if p.date < FILL_START] or points
    band: list[BandMonth] = []
    for month in range(1, 13):
        vals = [p.value for p in baseline if p.date.month == month]
        if vals:
            pad = 0.03 if measure != "roughness" else 0.5
            band.append(
                BandMonth(
                    month=month,
                    lo=round(min(vals) - pad, 3),
                    hi=round(max(vals) + pad, 3),
                    mean=round(sum(vals) / len(vals), 3),
                )
            )
    last = points[-1]
    prov = Provenance(
        provider="planetary_s1_rtc" if measure == "roughness" else "earth_search_s2",
        satellite="Sentinel-1" if measure == "roughness" else "Sentinel-2",
        scene=f"{len(points)} scenes",
        date=last.date,
        cloud_over_area=0.0,
        resolution_m=20,
        method=f"{_METHOD[measure]}, clearest scene per {every}, 20 m (stub)",
    )
    return Series(measure=measure, points=points, band=band, provenance=prov)


def compare(area: Area, measure: Measure, before: date, after: date) -> Comparison:
    def stats_at(d: date) -> Stats:
        scene = _radar_scene(d) if measure == "roughness" else _optical_scene(d, max_cloud=100)
        return _stats(index(load(area, scene), measure))

    b, a = stats_at(before), stats_at(after)
    delta = round(a.mean - b.mean, 3)
    full = abs(_LEVELS[measure][1] - _LEVELS[measure][0])
    changed_ha = (
        0.0 if area.is_ring() else round(area.area_ha * min(1.0, abs(delta) / full) * 0.85, 2)
    )
    patches: list[Patch] = []
    if changed_ha > 0.05:
        lat, lon = area.centroid()
        blob = Area.from_point(lat, lon, radius_m=math.sqrt(changed_ha * 10_000 / math.pi))
        patches.append(Patch(ha=changed_ha, centroid=(lat, lon), geojson=blob.geojson))
    return Comparison(
        measure=measure,
        before=b,
        after=a,
        delta=delta,
        changed_ha=changed_ha,
        patches=patches,
        provenance=a.provenance,
    )


def layer_info(layer_id: str) -> tuple[Area, Scene, Measure | None]:
    """For render: the area, scene and measure behind a layer id."""
    return _layers[layer_id]


def mean_value(layer_id: str) -> float:
    area, scene, m = _layers[layer_id]
    return _value(m, scene.date, area.is_ring()) if m else 0.0


def layer_pixels(layer_id: str) -> tuple[np.ndarray, tuple[float, float, float, float]]:
    """A synthetic 128×128 image: the layer's mean value with texture, masked to a disc."""
    area, scene, m = _layers[layer_id]
    if m is None:
        raise NoClearScenes(
            "Raw band layers can't be rendered yet.", 'Call index(layer, "greenness") first.'
        )
    rng = np.random.default_rng(zlib.crc32(scene.id.encode()))
    spread = 1.0 if m == "roughness" else 0.06
    img = _value(m, scene.date, area.is_ring()) + rng.normal(0, spread, (128, 128))
    yy, xx = np.mgrid[-1:1:128j, -1:1:128j]
    img[(xx**2 + yy**2) > 1] = np.nan
    return img, area.bbox()


# --- place + context providers (M9a): Hoo Hok Wai, no network -----------------------------------

_HHW_LAT, _HHW_LON = 22.5340, 114.0906


def _hoo_hok_wai(name: str = "Hoo Hok Wai") -> PlaceHit:
    return PlaceHit(
        name=name,
        display_name=f"{name}, North District, New Territories, Hong Kong, China",
        lat=_HHW_LAT,
        lon=_HHW_LON,
        bbox=(114.0705794, 22.514013, 114.1105794, 22.554013),
        kind="place/hamlet",
        country="Hong Kong",
    )


def search_places(text: str, limit: int = 5) -> list[PlaceHit]:
    """Any text finds Hoo Hok Wai (Yuen Long / North District, Hong Kong)."""
    return [_hoo_hok_wai()][: max(1, limit)]


def reverse_place(lat: float, lon: float) -> PlaceHit | None:
    return _hoo_hok_wai()


def weather(area: Area, last: str = "14d") -> RainSeries:
    """Deterministic wet-season rain ending 30 Sep 2026: about 212 mm per 30 days."""
    n = window_days(last)
    raw = [max(0.0, 7.1 * (1 + math.sin(i * 1.7)) * (i % 3 != 0)) for i in range(n)]
    scale = 212.0 * min(n, 30) / 30 / (sum(raw[:30]) or 1.0)
    days = [
        RainDay(date=TODAY - timedelta(days=n - 1 - i), mm=round(mm * scale, 1))
        for i, mm in enumerate(raw)
    ]
    return RainSeries(
        days=days,
        total_mm=round(sum(d.mm for d in days), 1),
        lat=round(_HHW_LAT, 4),
        lon=round(_HHW_LON, 4),
    )


def layer_rgb(
    layer_id: str,
) -> tuple[np.ndarray, np.ndarray, tuple[float, float, float, float]]:
    """A synthetic 128×128 true-colour image (reflectance), greener when the stub is greener."""
    area, scene, _ = _layers[layer_id]
    g = min(max((_value("greenness", scene.date, area.is_ring()) + 0.1) / 0.9, 0.0), 1.0)
    rng = np.random.default_rng(zlib.crc32(scene.id.encode()))
    tex = rng.normal(0, 0.012, (128, 128))
    green = np.array([0.04, 0.09, 0.035])
    brown = np.array([0.15, 0.12, 0.09])
    base = brown * (1 - g) + green * g
    img = (base[None, None, :] + tex[..., None]).astype(np.float32).clip(0.005, None)
    yy, xx = np.mgrid[-1:1:128j, -1:1:128j]
    return img, (xx**2 + yy**2) <= 1, area.bbox()
