"""M9a: place search, terrain, land cover and rain providers.

Offline by default (stub, rate limiter, cache). Network tests need EARTH_NETWORK_TESTS=1:
    EARTH_IMPL=real EARTH_NETWORK_TESTS=1 uv run pytest tests/test_earth_context.py
"""

from __future__ import annotations

import os
import threading

import numpy as np
import pytest

import earth
from earth import settings
from earth.errors import EarthError
from earth.presets import HOO_HOK_WAI
from earth.providers import context, nominatim, openmeteo, planetary

NETWORK = os.environ.get("EARTH_NETWORK_TESTS") == "1"
network = pytest.mark.skipif(not NETWORK, reason="set EARTH_NETWORK_TESTS=1 to hit real APIs")


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    earth.set_run("r_test")
    earth.set_listener(None)
    yield
    earth.set_run(None)


@pytest.fixture
def stub(monkeypatch):
    monkeypatch.setenv("EARTH_IMPL", "stub")


# --- stub (never touches the network) -----------------------------------------------------------


def test_stub_search_reverse_weather(stub, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("network used in stub mode")

    monkeypatch.setattr(nominatim, "_http_get", boom)
    monkeypatch.setattr(openmeteo, "_get", boom)
    hits = earth.search_places("anything", limit=3)
    assert hits[0].name == "Hoo Hok Wai"
    assert (hits[0].lat, hits[0].lon) == (22.5340, 114.0906)
    assert hits[0].country == "Hong Kong"
    assert hits[0].area().area_ha > 1
    assert earth.reverse_place(22.5, 114.0).country == "Hong Kong"
    rain = earth.weather(HOO_HOK_WAI, last="30d")
    assert len(rain.days) == 30
    assert rain.total_mm == pytest.approx(212, abs=3)
    assert "not satellite" in rain.source
    assert len(earth.weather(HOO_HOK_WAI).days) == 14


def test_weather_rejects_bad_window(stub):
    with pytest.raises(EarthError):
        earth.weather(HOO_HOK_WAI, last="soon")


def test_traced_summaries(stub):
    seen = []
    earth.set_listener(seen.append)
    earth.search_places("x")
    earth.weather(HOO_HOK_WAI, "30d")
    assert seen[0].summary.startswith("Found 1 places")
    assert (
        seen[1].summary
        == f"Rain: {earth.weather(HOO_HOK_WAI, '30d').total_mm:.0f} mm in 30 days (weather model)"
    )


# --- Nominatim: rate limiter, cache, parsing ----------------------------------------------------

RAW = {
    "lat": "22.3415759",
    "lon": "114.1948272",
    "category": "railway",
    "type": "station",
    "name": "Wong Tai Sin",
    "display_name": "Wong Tai Sin, Hong Kong",
    "boundingbox": ["22.3412", "22.3419", "114.1928", "114.1951"],
    "address": {"ISO3166-2-lvl3": "CN-HK", "country": "China"},
    "geojson": {
        "type": "Polygon",
        "coordinates": [
            [[114.1928, 22.3412], [114.1951, 22.3412], [114.1951, 22.3419], [114.1928, 22.3412]]
        ],
    },
}


def test_rate_limiter_spaces_requests(monkeypatch):
    now = [100.0]
    sleeps = []
    monkeypatch.setattr(nominatim, "_clock", lambda: now[0])
    monkeypatch.setattr(
        nominatim, "_sleep", lambda s: (sleeps.append(s), now.__setitem__(0, now[0] + s))
    )
    monkeypatch.setattr(nominatim, "_last_request", 0.0)
    nominatim._throttle()  # first: no wait
    nominatim._throttle()
    nominatim._throttle()
    assert sleeps == [pytest.approx(1.0), pytest.approx(1.0)]


def test_rate_limiter_is_thread_safe(monkeypatch):
    stamps = []
    monkeypatch.setattr(settings, "NOMINATIM_MIN_INTERVAL_S", 0.05)
    monkeypatch.setattr(nominatim, "_last_request", 0.0)

    def hit():
        nominatim._throttle()
        stamps.append(nominatim._last_request)

    threads = [threading.Thread(target=hit) for _ in range(5)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    stamps.sort()
    assert all(b - a >= 0.045 for a, b in zip(stamps, stamps[1:], strict=False))


def test_search_parses_and_caches(monkeypatch):
    calls = []

    def fake(url):
        calls.append(url)
        return [RAW]

    monkeypatch.setattr(nominatim, "_http_get", fake)
    hits = nominatim.search("  Wong   Tai SIN ")
    assert hits[0].bbox == (114.1928, 22.3412, 114.1951, 22.3419)  # (w, s, e, n)
    assert hits[0].country == "Hong Kong"
    assert hits[0].kind == "railway/station"
    assert "polygon_geojson=1" in calls[0] and "format=jsonv2" in calls[0]
    again = nominatim.search("wong tai sin")  # normalised key → cache
    assert again == hits and len(calls) == 1
    assert list((settings.data_dir() / "cache" / "nominatim").glob("*.json"))


def test_reverse_none_is_cached(monkeypatch):
    calls = []
    monkeypatch.setattr(nominatim, "_http_get", lambda url: calls.append(url) or {"error": "x"})
    assert nominatim.reverse(0.0, -30.0) is None
    assert nominatim.reverse(0.0, -30.0) is None
    assert len(calls) == 1


def test_place_area_polygon_or_circle():
    hit = nominatim._hit(RAW)
    assert hit.geojson is not None
    poly = hit.area()
    assert poly.geojson["type"] == "Polygon" and poly.name == "Wong Tai Sin"
    circle = hit.model_copy(update={"geojson": None}).area(radius_m=400)
    assert circle.area_ha == pytest.approx(50.3, rel=0.02)
    huge = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
    assert hit.model_copy(update={"geojson": huge}).area().area_ha < 100  # fell back to circle


def test_http_errors_become_earth_errors(monkeypatch):
    import urllib.error

    def raise_url(*a, **k):
        raise urllib.error.URLError("down")

    monkeypatch.setattr(nominatim, "_throttle", lambda: None)
    monkeypatch.setattr("urllib.request.urlopen", raise_url)
    with pytest.raises(EarthError) as ei:
        nominatim._http_get("https://nominatim.invalid/x")
    assert ei.value.hint


# --- Planetary pieces that need no network ------------------------------------------------------


def test_slope_degrees_plane():
    y, x = np.mgrid[0:20, 0:20]
    z = x * 30.0 * np.tan(np.radians(10))  # 10° slope east at 30 m cells
    assert planetary.slope_degrees(z, 30.0)[5:15, 5:15] == pytest.approx(10.0, abs=0.01)


def test_worldcover_names():
    assert (
        planetary.WORLDCOVER_CLASSES[50] == "built"
        and planetary.WORLDCOVER_CLASSES[95] == "mangroves"
    )
    assert len(planetary.WORLDCOVER_CLASSES) == 11


def test_open_meteo_window_and_cache(monkeypatch):
    area = HOO_HOK_WAI
    calls = []

    def fake(url, params):
        calls.append(params)
        n = params["past_days"] + 1
        times = [f"2026-09-{d:02d}" for d in range(30 - n + 1, 31)]
        return {"daily": {"time": times, "precipitation_sum": [1.0] * (n - 1) + [None]}}

    monkeypatch.setattr(openmeteo, "_get", fake)
    r = openmeteo.rain(area, "10d")
    assert len(r.days) == 10 and r.total_mm == 10.0
    assert calls[0]["past_days"] == 11
    openmeteo.rain(area, "10d")
    assert len(calls) == 1  # cached


# --- place_context degrades instead of failing --------------------------------------------------


def test_place_context_degrades(monkeypatch):
    def fail(*a, **k):
        raise EarthError("service down", "retry")

    monkeypatch.setattr(nominatim, "reverse", lambda lat, lon: nominatim._hit(RAW))
    monkeypatch.setattr(planetary, "terrain", fail)
    monkeypatch.setattr(
        planetary,
        "worldcover",
        lambda a: planetary.LandCover(shares={"water": 1.0}, year=2021, resolution_m=10),
    )
    monkeypatch.setattr(
        openmeteo, "rain", lambda a, last="30d": (_ for _ in ()).throw(RuntimeError("boom"))
    )
    parts = context.place_context(HOO_HOK_WAI)
    assert parts.name == "Hoo Hok Wai ponds" and parts.country == "Hong Kong"
    assert parts.land_cover == {"water": 1.0}
    assert parts.elevation_m is None and parts.slope_deg is None and parts.rain_mm_30d is None
    assert len(parts.warnings) == 2
    assert any("service down" in w for w in parts.warnings)


# --- real APIs ----------------------------------------------------------------------------------


@network
@pytest.mark.parametrize("query", ["Wong Tai Sin", "Lake Mead", "Hoo Hok Wai"])
def test_real_search(query):
    hits = nominatim.search(query, 3)
    assert hits and -90 < hits[0].lat < 90 and -180 < hits[0].lon < 180
    assert hits[0].area().area_ha > 0


@network
def test_real_reverse_hk():
    hit = nominatim.reverse(22.5340, 114.0906)
    assert hit is not None and hit.country == "Hong Kong"


@network
@pytest.mark.parametrize(
    ("lat", "lon", "country", "steep"),
    [
        (22.5340, 114.0906, "Hong Kong", False),  # Hoo Hok Wai, Asia
        (47.3050, 11.3900, "Austria", True),  # Nordkette slope, Europe
        (-12.70, -55.60, "Brazil", False),  # Mato Grosso farmland, South America
    ],
)
def test_real_place_context(lat, lon, country, steep):
    parts = context.place_context(earth.Area.from_point(lat, lon, 400))
    assert parts.warnings == []
    assert parts.country == country
    assert sum(parts.land_cover.values()) == pytest.approx(1.0, abs=0.02)
    assert parts.elevation_m and parts.elevation_m.min <= parts.elevation_m.max
    assert parts.slope_deg and (parts.slope_deg.mean > 15) == steep
    assert parts.rain_mm_30d is not None and parts.rain_mm_30d >= 0
    if country == "Brazil":
        assert parts.land_cover["cropland"] > 0.8
