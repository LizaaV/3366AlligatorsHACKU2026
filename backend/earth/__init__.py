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
import re
import typing
from datetime import date
from types import ModuleType

from pyproj import Transformer
from shapely.ops import transform

from earth import settings, show
from earth.blocks import Block, validate_block
from earth.calls import current_run, set_listener, set_run, traced
from earth.errors import (
    AreaTooSmall,
    BudgetExceeded,
    EarthError,
    InvalidArea,
    NoClearScenes,
    WrongSceneKind,
)
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
    "PlaceHit",
    "Provenance",
    "RainSeries",
    "RenderedLayer",
    "Scene",
    "SceneList",
    "Series",
    "Stats",
    "WrongSceneKind",
    "compare",
    "describe",
    "index",
    "load",
    "measure",
    "render",
    "reverse_place",
    "scenes",
    "search_places",
    "series",
    "set_listener",
    "set_run",
    "show",
    "surroundings",
    "validate_block",
    "weather",
]


def _impl() -> ModuleType:
    return importlib.import_module("earth._stub" if settings.impl() == "stub" else "earth.real")


_LAST = re.compile(r"^[1-9]\d{0,3}[dwmy]$")
_EVERY = ("month", "quarter", "year")


def _check_measure(measure: object) -> None:
    valid = typing.get_args(Measure)
    if measure not in valid:
        raise EarthError(
            f"Unknown measure {measure!r}.", "Use one of: " + ", ".join(f'"{m}"' for m in valid)
        )


def _check_kind(kind: object) -> None:
    valid = typing.get_args(SceneKind)
    if kind not in valid:
        raise EarthError(
            f"Unknown scene kind {kind!r}.", "Use one of: " + ", ".join(f'"{k}"' for k in valid)
        )


def _check_last(last: object) -> None:
    if not isinstance(last, str) or not _LAST.fullmatch(last):
        raise EarthError(
            f"Can't read last={last!r} as a time window.", 'Use like "60d", "8w", "6m", "1y".'
        )


def _check_every(every: object) -> None:
    if every not in _EVERY:
        raise EarthError(f"every={every!r} is not supported.", 'Use "month" | "quarter" | "year".')


def _check_size(area: Area) -> None:
    if area.area_ha > settings.MAX_AREA_HA:
        raise BudgetExceeded(
            f"{area.area_ha:.0f} ha is above the {settings.MAX_AREA_HA} ha limit.",
            "draw a smaller outline (max 25 km² for now)",
        )
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
    _check_last(last)
    _check_kind(kind)
    return _impl().scenes(area, last=last, kind=kind, max_cloud=max_cloud)


@traced(lambda r: f"Read {r.provenance.satellite} scene from {r.date:%d %b %Y}")
def load(area: Area, scene: Scene) -> LayerRef:
    _check_size(area)
    return _impl().load(area, scene)


@traced(lambda r: f"Computed {r.measure} for {r.date:%d %b %Y}")
def index(layer: LayerRef, measure: Measure) -> LayerRef:
    _check_measure(measure)
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
    _check_measure(measure)
    _check_every(every)
    _check_size(area)
    return _impl().series(area, measure, years=years, every=every)


@traced(
    lambda c: (
        f"{c.measure.capitalize()} {c.before.mean:.2f} → {c.after.mean:.2f} "
        f"({c.delta:+.2f}), {c.changed_ha:.1f} ha changed"
    )
)
def compare(area: Area, measure: Measure, before: date | str, after: date | str) -> Comparison:
    _check_measure(measure)
    d_before, d_after = _as_date(before), _as_date(after)
    if d_before >= d_after:
        raise EarthError(
            f"before ({d_before}) is not earlier than after ({d_after}).",
            'Pass before < after, ISO dates like "2026-03-01".',
        )
    _check_size(area)
    return _impl().compare(area, measure, d_before, d_after)


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
    if isinstance(d, date):
        return d
    try:
        return date.fromisoformat(d)
    except (TypeError, ValueError) as exc:
        raise EarthError(f"Can't read {d!r} as a date.", 'ISO dates like "2026-03-01".') from exc


# --- places and weather (M9a) -------------------------------------------------------------------
# Not in `earth.real` (M1/M2 own it): in real mode these call the providers directly.

from earth.providers import nominatim as _nominatim  # noqa: E402
from earth.providers import openmeteo as _openmeteo  # noqa: E402
from earth.providers.nominatim import PlaceHit  # noqa: E402
from earth.providers.openmeteo import RainSeries  # noqa: E402


@traced(
    lambda hits: (
        f"Found {len(hits)} places, best: {hits[0].display_name.split(',')[0]}"
        if hits
        else "Found 0 places"
    )
)
def search_places(text: str, limit: int = 5) -> list[PlaceHit]:
    """Places matching free text, best first; `hit.area()` turns one into an `Area`."""
    if settings.impl() == "stub":
        return _impl().search_places(text, limit)
    return _nominatim.search(text, limit)


@traced(lambda hit: f"Looked up the place: {hit.name}" if hit else "No named place here")
def reverse_place(lat: float, lon: float) -> PlaceHit | None:
    """The place at a coordinate, or None (e.g. open ocean)."""
    if settings.impl() == "stub":
        return _impl().reverse_place(lat, lon)
    return _nominatim.reverse(lat, lon)


@traced(lambda r: f"Rain: {r.total_mm:.0f} mm in {len(r.days)} days (weather model)")
def weather(area: Area, last: str = "14d") -> RainSeries:
    """Daily rain at the area's centre. A weather model, NOT a satellite measurement."""
    _check_last(last)
    if settings.impl() == "stub":
        return _impl().weather(area, last)
    return _openmeteo.rain(area, last)
