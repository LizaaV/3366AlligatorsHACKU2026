"""POST /api/runs with a saved place_id runs on that place's outline (not the demo preset)."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app

GEOJSON = {
    "type": "Polygon",
    "coordinates": [
        [[11.57, 48.13], [11.58, 48.13], [11.58, 48.14], [11.57, 48.14], [11.57, 48.13]]
    ],
}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("RUNS_DB_PATH", str(tmp_path / "runs.sqlite"))
    return TestClient(app)


def _run_id(text: str) -> str:
    for line in text.splitlines():
        if line.startswith("data:") and '"run_id"' in line:
            return json.loads(line[5:])["run_id"]
    raise AssertionError("no run_id in stream")


def test_run_uses_the_saved_place_outline(client):
    place = client.post("/api/places", json={"name": "Munich test field", "geometry": GEOJSON})
    assert place.status_code == 201, place.text
    pid = place.json()["id"]
    res = client.post("/api/runs", json={"question": "Has anything changed here?", "place_id": pid})
    assert res.status_code == 200
    run = client.get(f"/api/runs/{_run_id(res.text)}").json()
    assert run["place_ids"] == [pid]
    assert run["area"]["name"] == "Munich test field"
    assert abs(run["area"]["area_ha"] - place.json()["area_ha"]) < 0.01


def test_unknown_place_is_404_not_the_preset(client):
    res = client.post("/api/runs", json={"question": "Anything?", "place_id": "pl_nope_123456"})
    assert res.status_code == 404


def test_explicit_area_wins_over_place_id(client):
    pid = client.get("/api/places").json()[0]["id"]  # seeded demo place
    res = client.post(
        "/api/runs",
        json={
            "question": "Anything?",
            "place_id": pid,
            "area": {"point": {"lat": 48.135, "lon": 11.575, "radius_m": 300}, "name": "Pin"},
        },
    )
    run = client.get(f"/api/runs/{_run_id(res.text)}").json()
    assert run["area"]["name"] == "Pin"
