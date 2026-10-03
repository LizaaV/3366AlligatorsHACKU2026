"""Real implementation (M1 read, M2 analysis, M9 providers). Selected with EARTH_IMPL=real.

Must provide the same functions as `earth._stub` with the same return types:
describe, scenes, load, index, measure, series, compare, layer_pixels.

M1 (this file): Sentinel-2 L2A optical `scenes`, `load`, `index`, `measure`, `layer_pixels`.
Pixels stay in two in-process registries:
  _groups: scene id → providers.earth_search.Group (the STAC items of one pass, tile edges merged)
  _layers: layer id → _Layer (area, scene, items, grid, valid mask, and index values once computed)
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import count
from typing import Any

import numpy as np

from earth import settings
from earth.errors import EarthError, NoClearScenes, WrongSceneKind
from earth.providers import earth_search as es
from earth.types import (
    Area,
    Comparison,
    LayerRef,
    Measure,
    PlaceContext,
    Provenance,
    Scene,
    SceneKind,
    SceneList,
    Series,
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
_RADAR_HINT = 'Use kind="optical" for now; radar (Sentinel-1) arrives with M9b.'


def _todo(module: str) -> NotImplementedError:
    return NotImplementedError(
        f"earth real implementation not built yet ({module}); use EARTH_IMPL=stub"
    )


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


_groups: dict[str, es.Group] = {}
_layers: dict[str, _Layer] = {}
_layer_ids = count(1)
_lock = threading.Lock()


def _new_layer_id() -> str:
    with _lock:
        return f"L{next(_layer_ids)}"


def _parse_last(last: str) -> int:
    return int(last[:-1]) * {"d": 1, "w": 7, "m": 30, "y": 365}[last[-1]]


def _radar_error() -> EarthError:
    return EarthError("Radar scenes are not available yet.", _RADAR_HINT)


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
    raise _todo("M2/M9a")


def scenes(
    area: Area, last: str = "60d", kind: SceneKind = "optical", max_cloud: int = 30
) -> SceneList:
    if kind == "radar":
        raise _radar_error()
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
    if scene.kind == "radar":
        raise _radar_error()
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
        raise NoClearScenes(
            "This layer has raw bands, not a measure.", 'Call index(layer, "greenness") first.'
        )
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


def series(area: Area, measure: Measure, years: int = 5, every: str = "month") -> Series:
    raise _todo("M2")


def compare(area: Area, measure: Measure, before: date, after: date) -> Comparison:
    raise _todo("M2")


def layer_tiles(layer_id: str) -> dict[str, int]:
    """Item id → clean pixels it supplied inside the area (more than one = tile-edge mosaic)."""
    return dict(_get(layer_id).tiles)


def layer_pixels(layer_id: str) -> tuple[np.ndarray, tuple[float, float, float, float]]:
    """2-D float array (NaN = masked) of the layer's measure, and its WGS84 bounds."""
    src = _get(layer_id)
    if src.values is None:
        raise NoClearScenes(
            "Raw band layers can't be rendered yet.", 'Call index(layer, "greenness") first.'
        )
    return src.values, es.wgs84_bounds(src.gbox)
