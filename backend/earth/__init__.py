"""`earth`: the only code that knows about satellites (HANDOFF B1, BUILD-PLAN I1).

    import earth
    area = earth.Area.from_point(22.49, 114.03, radius_m=350, name="Hoo Hok Wai")
    s = earth.scenes(area, last="60d")
    g = earth.index(earth.load(area, s.latest_clear()), "greenness")
    earth.measure(g)          # → Stats(mean=…, clean_px=…, provenance=…)
    earth.series(area, "greenness", years=4)
    earth.compare(area, "bare", before=date(2026, 3, 1), after=date(2026, 9, 30))
    earth.show.timeline(series, title="Greenness")

Every function returns small models, never arrays. EARTH_IMPL=stub|real picks the backend.
"""

from __future__ import annotations

import importlib
from datetime import date
from types import ModuleType

from pyproj import Transformer
from shapely.ops import transform

from earth import settings, show
from earth.blocks import Block, validate_block
from earth.calls import current_run, set_listener, set_run, traced
from earth.errors import AreaTooSmall, BudgetExceeded, EarthError, InvalidArea, NoClearScenes
from earth.render import colourise, layer_path, layer_url, write_png
from earth.types import (
    Area,
    Comparison,
    EarthCall,
    LayerRef,
    Measure,
    PlaceContext,
    Provenance,
    RenderedLayer,
    Scene,
    SceneKind,
    SceneList,
    Series,
    Stats,
)

__all__ = [
    "Area",
    "AreaTooSmall",
    "Block",
    "BudgetExceeded",
    "Comparison",
    "EarthCall",
    "EarthError",
    "InvalidArea",
    "LayerRef",
    "Measure",
    "NoClearScenes",
    "PlaceContext",
    "Provenance",
    "RenderedLayer",
    "Scene",
    "SceneList",
    "Series",
    "Stats",
    "compare",
    "describe",
    "index",
    "load",
    "measure",
    "render",
    "scenes",
    "series",
    "set_listener",
    "set_run",
    "show",
    "surroundings",
    "validate_block",
]


def _impl() -> ModuleType:
    return importlib.import_module("earth._stub" if settings.impl() == "stub" else "earth.real")


def _check_size(area: Area) -> None:
    if area.pixels(10) < settings.MIN_PIXELS_10M:
        raise AreaTooSmall(
            f"{area.area_ha:.2f} ha ≈ {area.pixels(10)} pixels at 10 m. "
            "Changes under ~20 m are invisible.",
            "Report with low confidence, or enlarge the area.",
        )


def _sat(kind: str) -> str:
    return "Sentinel-1" if kind == "radar" else "Sentinel-2"


@traced(
    lambda c: (
        f"Looked up {c.name or 'the area'}: {c.area_ha:.1f} ha, "
        f"{c.recent_scenes.clear} clear scenes in 60 days"
    )
)
def describe(area: Area) -> PlaceContext:
    return _impl().describe(area)


@traced(lambda s: f"Searched {_sat(s.kind)}: {len(s.scenes)} scenes, {len(s.clear())} clear")
def scenes(
    area: Area, last: str = "60d", kind: SceneKind = "optical", max_cloud: int = 30
) -> SceneList:
    return _impl().scenes(area, last=last, kind=kind, max_cloud=max_cloud)


@traced(lambda r: f"Read {r.provenance.satellite} scene from {r.date:%d %b %Y}")
def load(area: Area, scene: Scene) -> LayerRef:
    _check_size(area)
    return _impl().load(area, scene)


@traced(lambda r: f"Computed {r.measure} for {r.date:%d %b %Y}")
def index(layer: LayerRef, measure: Measure) -> LayerRef:
    return _impl().index(layer, measure)


@traced(lambda s: f"Mean {s.mean:.3f} over {s.clean_px} clean pixels, cloud {s.cloud:.0%}")
def measure(layer: LayerRef) -> Stats:
    return _impl().measure(layer)


@traced(
    lambda s: (
        f"{s.measure.capitalize()} over {len(s.points)} scenes, "
        f"{s.points[0].date:%b %Y}–{s.points[-1].date:%b %Y}"
    )
)
def series(area: Area, measure: Measure, years: int = 5, every: str = "month") -> Series:
    _check_size(area)
    return _impl().series(area, measure, years=years, every=every)


@traced(
    lambda c: (
        f"{c.measure.capitalize()} {c.before.mean:.2f} → {c.after.mean:.2f} "
        f"({c.delta:+.2f}), {c.changed_ha:.1f} ha changed"
    )
)
def compare(area: Area, measure: Measure, before: date | str, after: date | str) -> Comparison:
    _check_size(area)
    return _impl().compare(area, measure, _as_date(before), _as_date(after))


@traced(lambda a: f"Took the {a.area_ha:.0f} ha ring around the area")
def surroundings(area: Area, ring_m: int = 300) -> Area:
    """The ring around the outline, for local-vs-regional comparisons."""
    utm = f"EPSG:{area.utm_epsg()}"
    fwd = Transformer.from_crs("EPSG:4326", utm, always_xy=True).transform
    back = Transformer.from_crs(utm, "EPSG:4326", always_xy=True).transform
    inner = transform(fwd, area.geometry())
    ring = transform(back, inner.buffer(ring_m).difference(inner))
    name = f"{area.name} surroundings" if area.name else "surroundings"
    return Area._from_geometry(ring, name)


@traced(lambda r: f"Rendered the {r.measure or 'colour'} map for {r.date:%d %b %Y}")
def render(layer: LayerRef) -> RenderedLayer:
    """Writes the PNG now (data/layers/{run_id}/{measure}/{scene}.png) and returns its URL."""
    if layer.measure is None:
        raise EarthError("Only measure layers can be rendered for now.", "Call index() first.")
    values, bounds = _impl().layer_pixels(layer.id)
    run_id = current_run()
    write_png(colourise(values, layer.measure), layer_path(run_id, layer.measure, layer.scene))
    return RenderedLayer(
        layer_id=layer.id,
        url=layer_url(run_id, layer.measure, layer.scene),
        bounds=bounds,
        measure=layer.measure,
        scene=layer.scene,
        date=layer.date,
    )


def _as_date(d: date | str) -> date:
    return d if isinstance(d, date) else date.fromisoformat(d)
