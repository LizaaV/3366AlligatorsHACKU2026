"""Resolve what the user gave us (pin, outline, map link, text) into an `earth.Area`.

Used by `POST /api/areas/resolve` (BUILD-PLAN I5, HANDOFF B10). No network: links and
coordinates are parsed locally, place names hit a tiny demo gazetteer, and free-text search
waits for the Nominatim provider (module M9a).
"""

from __future__ import annotations

import importlib
import re
from collections.abc import Callable
from typing import Any
from urllib.parse import unquote

import earth
from app.schemas.areas import AreaMatch, AreaResolveRequest, AreaResolveResponse
from earth.presets import HOO_HOK_WAI

DEFAULT_RADIUS_M = 400.0

SEARCH_UNAVAILABLE = (
    "Place search arrives with the Nominatim provider; drop a pin or paste coordinates"
)


class SearchUnavailable(Exception):
    """No geocoder is installed yet; the route maps this to HTTP 501."""


# Demo presets, keyed by normalised name.
_GAZETTEER: dict[str, earth.Area] = {
    "hoo hok wai": HOO_HOK_WAI,
    "hoo hok wai ponds": HOO_HOK_WAI,
    "hoo hok wai fish ponds": HOO_HOK_WAI,
}

_NUM = r"[-+]?\d{1,3}(?:\.\d+)?"
_PAIR = rf"(?P<lat>{_NUM})\s*,\s*(?P<lon>{_NUM})"

# Plain "lat, lon" text, nothing else.
_PLAIN = re.compile(rf"^\s*\(?\s*{_PAIR}\s*\)?\s*$")

# Map-link patterns, most specific first.
_LINK_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Google place data: ...!3d22.53!4d114.09 (the actual pin, better than the @ viewport)
    re.compile(rf"!3d(?P<lat>{_NUM})!4d(?P<lon>{_NUM})"),
    # geo:22.53,114.09 (Android / WhatsApp)
    re.compile(rf"^\s*geo:{_PAIR}", re.IGNORECASE),
    # Query params: ?q= / &ll= / query= / center= / daddr= / sll= (Google, Apple, OSM-ish)
    re.compile(
        rf"[?&](?:q|ll|sll|query|center|daddr|destination|loc)=(?:loc:)?{_PAIR}",
        re.IGNORECASE,
    ),
    # Google viewport: /@22.53,114.09,15z
    re.compile(rf"@{_PAIR}"),
    # OSM: #map=15/22.53/114.09
    re.compile(rf"#map=\d+(?:\.\d+)?/(?P<lat>{_NUM})/(?P<lon>{_NUM})"),
)


def _normalise(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


def _point(lat: float, lon: float, name: str | None = None) -> earth.Area:
    """`earth.Area.from_point` raises `earth.InvalidArea` for out-of-range coordinates."""
    return earth.Area.from_point(lat, lon, radius_m=DEFAULT_RADIUS_M, name=name)


def parse_coordinates(text: str) -> tuple[float, float] | None:
    """Plain "lat, lon" text → (lat, lon), or None if it isn't that shape."""
    m = _PLAIN.match(text)
    return (float(m["lat"]), float(m["lon"])) if m else None


def parse_link(link: str) -> tuple[float, float] | None:
    """A Google / Apple / OSM / WhatsApp / geo: link → (lat, lon), or None if none is found."""
    text = unquote(unquote(link.strip()))  # %2C → , (sometimes double-encoded)
    for pattern in _LINK_PATTERNS:
        m = pattern.search(text)
        if m:
            return float(m["lat"]), float(m["lon"])
    return None


def _check_range(lat: float, lon: float) -> None:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        swapped = -90 <= lon <= 90 and -180 <= lat <= 180
        hint = "Use lat in [-90, 90] and lon in [-180, 180], as 'lat, lon'."
        if swapped:
            hint = "Did you swap them? Write 'lat, lon' (e.g. '22.53, 114.09'). " + hint
        raise earth.InvalidArea(f"Not a valid coordinate: {lat}, {lon}", hint)


def _resolve_link(link: str) -> AreaResolveResponse:
    plain = parse_coordinates(link)
    if plain is not None:
        _check_range(*plain)
        return AreaResolveResponse(area=_point(*plain), source="coordinates")
    found = parse_link(link)
    if found is None:
        raise earth.InvalidArea(
            "Couldn't find coordinates in that link.",
            "Open the link and copy the full URL (short links like goo.gl can't be read), "
            "or paste 'lat, lon' or drop a pin.",
        )
    _check_range(*found)
    return AreaResolveResponse(area=_point(*found), source="link")


def _geocoder() -> Callable[[str], Any] | None:
    """Meet's Nominatim provider (M9a), if it has landed: `earth.geocode` or the provider module."""
    fn = getattr(earth, "geocode", None)
    if callable(fn):
        return fn
    for mod_name in ("earth.providers.nominatim", "earth.nominatim"):
        try:
            mod = importlib.import_module(mod_name)
        except ImportError:
            continue
        for attr in ("geocode", "search"):
            fn = getattr(mod, attr, None)
            if callable(fn):
                return fn
    return None


def _describe(
    name: str, display_name: str | None, country: str | None, region: str | None
) -> str | None:
    """Where it is: 'London, United Kingdom'. Uses the geocoder's region when it has one, else
    the first non-street part of the full address."""
    if region and region != country:
        return f"{region}, {country}" if country else region
    parts = [p.strip() for p in (display_name or "").split(",") if p.strip()]
    parts = [p for p in parts if p != name and not any(c.isdigit() for c in p)]
    if not parts:
        return country
    return parts[-1] if len(parts) == 1 else f"{parts[-2]}, {parts[-1]}"


def _kind(kind: str | None) -> str | None:
    """OSM 'class/type' -> the plain type ('place/city' -> 'city', 'leisure/park' -> 'park')."""
    if not kind:
        return None
    return str(kind).split("/")[-1].replace("_", " ") or None


def _as_match(item: Any) -> AreaMatch | None:
    """Accept whatever the geocoder returns per hit: a model/object or a dict with name/lat/lon."""
    get = item.get if isinstance(item, dict) else lambda k, d=None: getattr(item, k, d)
    lat, lon = get("lat"), get("lon")
    if lat is None or lon is None:
        return None
    display = get("display_name")
    name = get("name") or (display.split(",")[0] if display else None)
    name = name or f"{float(lat):.4f}, {float(lon):.4f}"
    return AreaMatch(
        name=str(name),
        lat=float(lat),
        lon=float(lon),
        description=_describe(str(name), display, get("country"), get("region")),
        kind=_kind(get("kind")),
    )


def _dedupe(matches: list[AreaMatch]) -> list[AreaMatch]:
    """Drop repeats: the same name in the same region (geocoders often return a city twice,
    once as the town and once as its boundary, a few km apart)."""
    seen: set[tuple[str, str]] = set()
    out = []
    for m in matches:
        key = (m.name.lower(), (m.description or f"{m.lat:.2f},{m.lon:.2f}").lower())
        if key not in seen:
            seen.add(key)
            out.append(m)
    return out


def _search(query: str) -> AreaResolveResponse:
    geocode = _geocoder()
    if geocode is None:
        raise SearchUnavailable(SEARCH_UNAVAILABLE)
    result = geocode(query)
    if isinstance(result, earth.Area):
        return AreaResolveResponse(area=result, source="search")
    hits = result if isinstance(result, list | tuple) else [result]
    matches = _dedupe([m for m in (_as_match(h) for h in hits if h is not None) if m is not None])
    if not matches:
        raise earth.InvalidArea(
            f"No place found for {query!r}.",
            "Try a different name, drop a pin or paste 'lat, lon'.",
        )
    best = matches[0]
    return AreaResolveResponse(
        area=_point(best.lat, best.lon, name=best.name),
        source="search",
        matches=matches[1:],
        best=best,
    )


def _resolve_query(query: str) -> AreaResolveResponse:
    coords = parse_coordinates(query)
    if coords is not None:
        _check_range(*coords)
        return AreaResolveResponse(area=_point(*coords), source="coordinates")
    preset = _GAZETTEER.get(_normalise(query))
    if preset is not None:
        return AreaResolveResponse(area=preset.model_copy(deep=True), source="preset")
    if not _normalise(query):
        raise earth.InvalidArea("The search text is empty.", "Type a place name or 'lat, lon'.")
    return _search(query)


def resolve(req: AreaResolveRequest) -> AreaResolveResponse:
    """Exactly one of point / geojson / link / query is set (the schema enforces it).

    Raises `earth.InvalidArea` (→ 422) for unusable input, `SearchUnavailable` (→ 501).
    """
    if req.point is not None:
        p = req.point
        area = earth.Area.from_point(p.lat, p.lon, radius_m=p.radius_m)
        return AreaResolveResponse(area=area, source="point")
    if req.geojson is not None:
        return AreaResolveResponse(area=earth.Area.from_geojson(req.geojson), source="geojson")
    if req.link is not None:
        return _resolve_link(req.link)
    assert req.query is not None
    return _resolve_query(req.query)


def describe(area: earth.Area) -> earth.PlaceContext:
    """`earth.describe` without the per-run call counter.

    `earth.describe` is `@traced`, which bumps a process-global counter capped at
    `settings.MAX_CALLS` (meant for one agent run in a sandbox child). In the long-lived API
    process that cap would turn every request after the 30th into BudgetExceeded, so we call
    the undecorated function.
    """
    fn = getattr(earth.describe, "__wrapped__", earth.describe)
    return fn(area)
