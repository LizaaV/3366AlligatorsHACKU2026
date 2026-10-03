"""`earth` inside the Docker sandbox (HANDOFF B2.1). Installed as `earth/__init__.py` in the image.

Same public names as the real `earth` package. Classes (`Area`, `Scene`, ...) and `earth.show` are
the real pure-pydantic modules, copied into the image; every public *function* is forwarded to the
trusted earth service (`app/services/earth_service.py`) at $EARTH_SERVICE_URL with the run's
$EARTH_TOKEN. No providers, no keys, no pixels in here: layers stay ids (`LayerRef`).

The service logs each call (`EarthCall`) for the UI itself, so `set_listener` is a no-op here.
Not imported by the backend; `tests/test_docker_sandbox.py` checks it stays in sync with `earth`.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import date
from typing import Any

from pydantic import BaseModel, TypeAdapter
from pydantic_core import to_jsonable_python

from earth import settings, show
from earth.blocks import Block, validate_block
from earth.errors import (
    AreaTooSmall,
    BudgetExceeded,
    EarthError,
    InvalidArea,
    NoClearScenes,
    WrongSceneKind,
)
from earth.types import (
    Area,
    Comparison,
    EarthCall,
    FireDetection,
    FireList,
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
    "FireDetection",
    "FireList",
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
    "fires",
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

CALL_TIMEOUT_S = 300  # the runner's own timeout stops the container first


# --- types defined next to their providers in the real package ----------------------------------


class PlaceHit(BaseModel):  # = earth.providers.nominatim.PlaceHit
    name: str
    display_name: str
    lat: float
    lon: float
    bbox: tuple[float, float, float, float]  # (west, south, east, north)
    kind: str
    country: str | None = None
    region: str | None = None
    geojson: dict | None = None

    def area(self, radius_m: float = 400) -> Area:
        """The polygon if there is one of a usable size (≥ 0.25 ha, < 25 km²), else a circle."""
        if self.geojson:
            try:
                poly = Area.from_geojson(self.geojson, name=self.name)
                if (
                    poly.pixels(10) >= settings.MIN_PIXELS_10M
                    and poly.area_ha < settings.MAX_AREA_HA
                ):
                    return poly
            except EarthError:
                pass
        return Area.from_point(self.lat, self.lon, radius_m=radius_m, name=self.name)


class RainDay(BaseModel):  # = earth.providers.openmeteo.RainDay
    date: date
    mm: float


class RainSeries(BaseModel):  # = earth.providers.openmeteo.RainSeries
    days: list[RainDay]
    total_mm: float
    source: str = "Open-Meteo (weather model, not satellite)"
    lat: float
    lon: float


# --- forwarding ---------------------------------------------------------------------------------

_ERRORS = {
    cls.kind: cls
    for cls in (
        EarthError,
        NoClearScenes,
        AreaTooSmall,
        BudgetExceeded,
        InvalidArea,
        WrongSceneKind,
    )
}


def set_listener(fn: Any) -> None:
    """No-op: the earth service logs calls itself (the container cannot forge the call log)."""


def set_run(run_id: str | None) -> None:
    """No-op: the run is fixed by the token the runner gave this container."""


def _call(fn: str, returns: Any, **kwargs: Any) -> Any:
    url = os.environ.get("EARTH_SERVICE_URL", "").rstrip("/") + f"/call/{fn}"
    body = json.dumps({"kwargs": to_jsonable_python(kwargs)}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {os.environ.get('EARTH_TOKEN', '')}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=CALL_TIMEOUT_S) as resp:  # noqa: S310
            data = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        try:
            data = json.loads(exc.read())
        except ValueError:
            raise RuntimeError(f"earth service answered HTTP {exc.code}") from None
        if "error" not in data:
            raise RuntimeError(f"earth service answered HTTP {exc.code}") from None
    except (urllib.error.URLError, OSError) as exc:
        raise RuntimeError(f"earth service unreachable: {exc}") from None

    if "error" in data:
        err = data["error"]
        kind, message, hint = err.get("kind"), err.get("message", ""), err.get("hint")
        if kind == "type_error":
            raise TypeError(message)
        if kind in _ERRORS:
            raise _ERRORS[kind](message, hint)
        if kind == "earth_error" or hint:
            raise EarthError(message, hint)
        raise RuntimeError(message)
    return TypeAdapter(returns).validate_python(data["ok"])


def describe(area: Area) -> PlaceContext:
    return _call("describe", PlaceContext, area=area)


def scenes(
    area: Area, last: str = "60d", kind: SceneKind = "optical", max_cloud: int = 30
) -> SceneList:
    return _call("scenes", SceneList, area=area, last=last, kind=kind, max_cloud=max_cloud)


def load(area: Area, scene: Scene) -> LayerRef:
    return _call("load", LayerRef, area=area, scene=scene)


def index(layer: LayerRef, measure: Measure) -> LayerRef:
    return _call("index", LayerRef, layer=layer, measure=measure)


def measure(layer: LayerRef) -> Stats:
    return _call("measure", Stats, layer=layer)


def series(area: Area, measure: Measure, years: int = 5, every: str = "month") -> Series:
    return _call("series", Series, area=area, measure=measure, years=years, every=every)


def compare(area: Area, measure: Measure, before: date | str, after: date | str) -> Comparison:
    return _call("compare", Comparison, area=area, measure=measure, before=before, after=after)


def surroundings(area: Area, ring_m: int = 300) -> Area:
    return _call("surroundings", Area, area=area, ring_m=ring_m)


def render(layer: LayerRef) -> RenderedLayer:
    return _call("render", RenderedLayer, layer=layer)


def search_places(text: str, limit: int = 5) -> list[PlaceHit]:
    return _call("search_places", list[PlaceHit], text=text, limit=limit)


def reverse_place(lat: float, lon: float) -> PlaceHit | None:
    return _call("reverse_place", PlaceHit | None, lat=lat, lon=lon)


def weather(area: Area, last: str = "14d") -> RainSeries:
    return _call("weather", RainSeries, area=area, last=last)


def fires(area: Area, last: str = "30d", radius_km: float = 10) -> FireList:
    return _call("fires", FireList, area=area, last=last, radius_km=radius_km)


_ = (Block, validate_block, show, FireDetection)  # re-exported
