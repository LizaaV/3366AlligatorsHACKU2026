"""`/api/areas/resolve` and `/api/areas/context` (no network: EARTH_IMPL=stub)."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import earth
from app.api.routes import areas as areas_routes
from app.services import areas as areas_service

# router.py wiring is owned elsewhere; mount the router on a local app so these tests
# don't depend on it.
_app = FastAPI()
_app.include_router(areas_routes.router, prefix="/api")
client = TestClient(_app)

SQUARE = {
    "type": "Polygon",
    "coordinates": [
        [[114.08, 22.53], [114.09, 22.53], [114.09, 22.54], [114.08, 22.54], [114.08, 22.53]]
    ],
}


@pytest.fixture(autouse=True)
def _stub(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EARTH_IMPL", "stub")


def _resolve(**body: object):
    return client.post("/api/areas/resolve", json=body)


def _centre(area: dict) -> tuple[float, float]:
    ring = area["geojson"]["coordinates"][0]
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return (min(lats) + max(lats)) / 2, (min(lons) + max(lons)) / 2


# --- point -------------------------------------------------------------------------------


def test_point() -> None:
    res = _resolve(point={"lat": 22.53, "lon": 114.09, "radius_m": 300})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "point"
    assert body["matches"] == []
    assert 25 < body["area"]["area_ha"] < 31  # π·300² ≈ 28.3 ha
    lat, lon = _centre(body["area"])
    assert lat == pytest.approx(22.53, abs=1e-3)
    assert lon == pytest.approx(114.09, abs=1e-3)


def test_point_out_of_range_is_422() -> None:
    assert _resolve(point={"lat": 95, "lon": 114.09}).status_code == 422


# --- links -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("link", "source"),
    [
        ("https://www.google.com/maps/@22.53,114.09,15z", "link"),
        (
            "https://www.google.com/maps/place/Somewhere/@22.50,114.00,17z/data=!3d22.53!4d114.09",
            "link",
        ),
        ("https://maps.google.com/?q=22.53,114.09", "link"),
        ("https://www.google.com/maps/search/?api=1&query=22.53%2C114.09", "link"),
        ("https://maps.apple.com/?ll=22.53,114.09&q=Dropped%20Pin", "link"),
        ("https://maps.apple.com/?q=22.53,114.09", "link"),
        ("geo:22.53,114.09?z=15", "link"),
        ("GEO:22.53,114.09", "link"),
        ("https://www.openstreetmap.org/#map=15/22.53/114.09", "link"),
        ("22.53, 114.09", "coordinates"),
        ("22.53,114.09", "coordinates"),
    ],
)
def test_link_formats(link: str, source: str) -> None:
    res = _resolve(link=link)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == source
    lat, lon = _centre(body["area"])
    assert lat == pytest.approx(22.53, abs=1e-3)
    assert lon == pytest.approx(114.09, abs=1e-3)


def test_place_link_prefers_pin_over_viewport() -> None:
    link = "https://www.google.com/maps/place/X/@10.0,10.0,12z/data=!4m6!3d22.53!4d114.09"
    lat, lon = _centre(_resolve(link=link).json()["area"])
    assert (round(lat, 2), round(lon, 2)) == (22.53, 114.09)


@pytest.mark.parametrize(
    "link",
    [
        "geo:95.0,114.09",
        "https://maps.google.com/?q=22.53,190.0",
        "https://www.google.com/maps/@-91,0,15z",
        "114.09, 22.53x",  # not a pair → no coordinates
        "120.5, 22.53",  # swapped
        "https://goo.gl/maps/abc123",
    ],
)
def test_bad_links_are_422(link: str) -> None:
    res = _resolve(link=link)
    assert res.status_code == 422, res.text
    detail = res.json()["detail"]
    assert detail["kind"] == "invalid_area"
    assert detail["message"]
    assert detail["hint"]


def test_swapped_coordinates_hint() -> None:
    detail = _resolve(link="114.09, 22.53").json()["detail"]
    assert "swap" in detail["hint"]


# --- geojson -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "geojson",
    [
        SQUARE,
        {"type": "Feature", "properties": {"name": "Square"}, "geometry": SQUARE},
        {
            "type": "FeatureCollection",
            "features": [{"type": "Feature", "properties": {}, "geometry": SQUARE}],
        },
    ],
)
def test_geojson_shapes(geojson: dict) -> None:
    res = _resolve(geojson=geojson)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "geojson"
    assert 100 < body["area"]["area_ha"] < 130  # ~1.03 km × 1.11 km


def test_feature_name_is_kept() -> None:
    feature = {"type": "Feature", "properties": {"name": "Square"}, "geometry": SQUARE}
    assert _resolve(geojson=feature).json()["area"]["name"] == "Square"


def test_invalid_polygon_is_422_with_hint() -> None:
    line = {"type": "LineString", "coordinates": [[114.08, 22.53], [114.09, 22.54]]}
    res = _resolve(geojson=line)
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["kind"] == "invalid_area"
    assert detail["hint"]


def test_swapped_polygon_hint() -> None:
    swapped = {"type": "Polygon", "coordinates": [[[y, x] for x, y in SQUARE["coordinates"][0]]]}
    res = _resolve(geojson=swapped)
    assert res.status_code == 422
    assert "swap" in res.json()["detail"]["hint"]


# --- query -------------------------------------------------------------------------------


@pytest.mark.parametrize("query", ["Hoo Hok Wai", "hoo hok wai", "  Hoo-Hok-Wai ponds "])
def test_preset_query(query: str) -> None:
    res = _resolve(query=query)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "preset"
    assert body["area"] == earth.presets.HOO_HOK_WAI.model_dump(mode="json")


def test_query_with_coordinates() -> None:
    res = _resolve(query="22.53, 114.09")
    assert res.status_code == 200
    assert res.json()["source"] == "coordinates"


def test_query_with_bad_coordinates() -> None:
    assert _resolve(query="22.53, 200").status_code == 422


def test_unknown_query_is_501(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(areas_service, "_geocoder", lambda: None)
    res = _resolve(query="Mong Kok")
    assert res.status_code == 501
    assert res.json()["detail"] == areas_service.SEARCH_UNAVAILABLE


def test_query_uses_geocoder_when_present(monkeypatch: pytest.MonkeyPatch) -> None:
    hits = [
        {"name": "Mong Kok", "lat": 22.319, "lon": 114.169},
        {"display_name": "Mong Kok East", "lat": "22.322", "lon": "114.172"},
    ]
    monkeypatch.setattr(areas_service, "_geocoder", lambda: lambda q: hits)
    res = _resolve(query="Mong Kok")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "search"
    assert body["area"]["name"] == "Mong Kok"
    [east] = body["matches"]
    assert (east["name"], east["lat"], east["lon"]) == ("Mong Kok East", 22.322, 114.172)
    assert body["best"]["name"] == "Mong Kok"


def test_search_describes_and_dedupes_hits(monkeypatch: pytest.MonkeyPatch) -> None:
    hits = [
        {
            "name": "Paris",
            "lat": 48.8589,
            "lon": 2.32,
            "kind": "boundary/administrative",
            "display_name": "Paris, Île-de-France, Metropolitan France, France",
            "country": "France",
        },
        {
            "name": "Paris",
            "lat": 33.66,
            "lon": -95.55,
            "kind": "place/city",
            "display_name": "Paris, Lamar County, Texas, United States",
            "country": "United States",
        },
        {
            "name": "Paris",
            "lat": 48.8589,
            "lon": 2.3201,
            "kind": "place/city",
            "display_name": "Paris, Île-de-France, Metropolitan France, France",
            "country": "France",
        },
    ]
    monkeypatch.setattr(areas_service, "_geocoder", lambda: lambda q: hits)
    body = _resolve(query="Paris").json()
    assert body["best"]["description"] == "Metropolitan France, France"
    assert body["best"]["kind"] == "administrative"
    # The second French "Paris" is the same place twice (same name, same region): dropped.
    assert [(m["name"], m["description"], m["kind"]) for m in body["matches"]] == [
        ("Paris", "Texas, United States", "city")
    ]


def test_exactly_one_field() -> None:
    assert _resolve().status_code == 422
    assert _resolve(query="Hoo Hok Wai", link="geo:22.5,114.0").status_code == 422


# --- context -----------------------------------------------------------------------------


def test_context_for_hoo_hok_wai() -> None:
    hhw = earth.presets.HOO_HOK_WAI
    res = client.post("/api/areas/context", json={"geojson": hhw.geojson, "name": hhw.name})
    assert res.status_code == 200, res.text
    ctx = earth.PlaceContext.model_validate(res.json())
    assert ctx.name == hhw.name
    assert ctx.area_ha == pytest.approx(hhw.area_ha, rel=1e-3)
    assert ctx.recent_scenes.optical > 0


def test_context_from_point() -> None:
    res = client.post("/api/areas/context", json={"point": {"lat": 22.534, "lon": 114.0906}})
    assert res.status_code == 200, res.text
    earth.PlaceContext.model_validate(res.json())


def test_context_does_not_hit_call_budget() -> None:
    body = {"point": {"lat": 22.534, "lon": 114.0906}}
    for _ in range(earth.settings.MAX_CALLS + 5):
        assert client.post("/api/areas/context", json=body).status_code == 200


def test_context_invalid_polygon_is_422_with_hint() -> None:
    point_geom = {"type": "Point", "coordinates": [114.08, 22.53]}
    res = client.post("/api/areas/context", json={"geojson": point_geom})
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["kind"] == "invalid_area"
    assert detail["hint"]


def test_context_needs_exactly_one() -> None:
    assert client.post("/api/areas/context", json={}).status_code == 422


def test_search_prefers_the_geocoder_region(monkeypatch: pytest.MonkeyPatch) -> None:
    hits = [
        {
            "name": "Hyde Park",
            "lat": 51.507,
            "lon": -0.165,
            "kind": "leisure/park",
            "display_name": "Hyde Park, Balderton Street, Mayfair, London, W1K 7TN, United Kingdom",
            "country": "United Kingdom",
            "region": "London",
        },
    ]
    monkeypatch.setattr(areas_service, "_geocoder", lambda: lambda q: hits)
    best = _resolve(query="Hyde Park").json()["best"]
    assert (best["description"], best["kind"]) == ("London, United Kingdom", "park")
