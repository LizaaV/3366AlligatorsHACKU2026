"""Live views (look before asking): recent passes and rendered bands for a spot. Offline."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import views

HHW = {"lat": 22.534, "lon": 114.0906}


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("EARTH_IMPL", "stub")
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    views._scene_cache.clear()
    with TestClient(app) as c:
        yield c


def test_passes_newest_first(client: TestClient) -> None:
    res = client.get("/api/views/passes", params=HHW)
    assert res.status_code == 200, res.text
    dates = [p["date"] for p in res.json()]
    assert dates and dates == sorted(dates, reverse=True)


@pytest.mark.parametrize("band", ["photo", "greenness", "water", "bare"])
def test_each_band_renders_a_png_with_bounds(client: TestClient, band: str) -> None:
    res = client.get("/api/views", params={**HHW, "band": band})
    assert res.status_code == 200, res.text
    body = res.json()
    west, south, east, north = body["bounds"]
    assert west < HHW["lon"] < east and south < HHW["lat"] < north
    png = client.get(body["url"])
    assert png.status_code == 200 and png.headers["content-type"] == "image/png"


def test_second_request_is_served_from_the_cache(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = client.get("/api/views", params={**HHW, "band": "water"}).json()

    def boom(*_args: object) -> None:
        raise AssertionError("rendered twice")

    monkeypatch.setattr(views, "_render", boom)
    again = client.get("/api/views", params={**HHW, "band": "water", "scene": first["scene"]})
    assert again.status_code == 200 and again.json()["url"] == first["url"]


def test_offline_data_elsewhere_is_an_honest_404(client: TestClient) -> None:
    res = client.get("/api/views", params={"lat": 48.85, "lon": 2.35, "band": "photo"})
    assert res.status_code == 404
    assert "EARTH_IMPL=real" in res.json()["detail"]


def test_bad_inputs(client: TestClient) -> None:
    assert client.get("/api/views", params={**HHW, "band": "ndvi"}).status_code == 422
    assert (
        client.get("/api/views", params={"lat": 95, "lon": 0, "band": "photo"}).status_code == 422
    )
    unknown = client.get("/api/views", params={**HHW, "band": "photo", "scene": "S2X_NOPE"})
    assert unknown.status_code == 404
