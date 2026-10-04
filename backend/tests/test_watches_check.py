"""Check now (build-plan A5): POST /api/watches/{id}/check, offline (EARTH_IMPL=stub)."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.watches import parse_condition, watch_message

POND = {
    "name": "Hoo Hok Wai ponds",
    "category_key": "water",
    "place_id": "pl_hhw",
    "skill_id": "pond-filling-check",
    "question": "Tell me if the fish ponds are filled in",
    "condition": "Open water drops below normal",
}


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("EARTH_IMPL", "stub")
    return TestClient(app)


def _create(client: TestClient, **over) -> dict:
    res = client.post("/api/watches", json={**POND, **over})
    assert res.status_code == 201, res.text
    return res.json()


def test_new_watch_has_sample_message(client: TestClient) -> None:
    w = _create(client)
    assert w["status"] is None and w["last_run_at"] is None
    assert w["message"].startswith("Sample · Hoo Hok Wai ponds")
    assert "usual <low> to <high>" in w["message"]
    assert "Sent when water index goes below its usual range" in w["message"]


def test_check_now_runs_pond_skill(client: TestClient) -> None:
    w = _create(client)
    res = client.post(f"/api/watches/{w['id']}/check")
    assert res.status_code == 200, res.text
    got = res.json()
    assert isinstance(got["value"], float)
    assert got["unit"] == "index"
    assert got["status"] in ("ok", "warn", "alert")
    assert got["last_run_at"] is not None
    assert got["baseline"] is not None
    ev = got["events"][0]["text"]
    assert ev.startswith("Checked the pass of ") and "water index" in ev and "(usual " in ev
    assert "Condition" in ev
    assert "pond-filling-check ran" in got["events"][0]["text"]
    assert got["message"].startswith("Hoo Hok Wai ponds · ")
    m = got["message"]
    assert "water index" in m and "(usual " in m and "ha changed" in m and "Condition" in m
    s = got["series"]
    assert s["labels"] and len(s["labels"]) == len(s["current"]) == len(s["band_low"])
    proof = client.get(f"/api/watches/{w['id']}/proof").json()
    assert proof["scenes"] and proof["hash"]
    # persisted
    listed = next(x for x in client.get("/api/watches").json() if x["id"] == w["id"])
    assert listed["value"] == got["value"] and listed["message"] == got["message"]


def test_check_now_without_skill_measures_directly(client: TestClient) -> None:
    w = _create(
        client,
        name="Greenness",
        skill_id="",
        question="Is the vegetation getting less green?",
        condition="Greenness drops below normal",
    )
    got = client.post(f"/api/watches/{w['id']}/check").json()
    assert got["status"] in ("ok", "warn", "alert")
    assert "greenness" in got["events"][0]["text"]


def test_check_errors(client: TestClient) -> None:
    assert client.post("/api/watches/w_nope/check").status_code == 404
    general = _create(client, place_id=None)
    assert client.post(f"/api/watches/{general['id']}/check").status_code == 409
    fire = _create(
        client,
        name="Fire",
        skill_id="active-fire-map",
        question="Tell me about fires near me",
        condition="Any VIIRS hotspot within 10 km",
    )
    assert client.post(f"/api/watches/{fire['id']}/check").status_code == 422
    # other user's watch
    w = _create(client)
    res = client.post(f"/api/watches/{w['id']}/check", headers={"X-User-Id": "u_other12345"})
    assert res.status_code == 404


def test_parse_condition() -> None:
    assert parse_condition("Open water drops below normal", "water").kind == "band"
    c = parse_condition("NDVI drops more than 0.1 between passes", "greenness")
    assert (c.kind, c.direction, c.threshold) == ("drop", "below", 0.1)
    c = parse_condition("Pond area without open water above 0.5 ha", "water")
    assert (c.kind, c.threshold, c.unit) == ("area", 0.5, "ha")
    assert parse_condition("Stress on more than 10% of plot", "greenness").unit == "%"
    assert parse_condition("Bare ground rises above normal", "bare").direction == "above"


def test_message_from_check() -> None:
    row = {
        "name": "x",
        "last_check": {
            "measure": "water",
            "value": -0.21,
            "lo": -0.05,
            "hi": 0.10,
            "change": "2.4 ha changed since 2 Jun 2026",
            "met": True,
            "relation": "below the usual range",
            "date": "2026-09-30",
            "place_name": "Hoo Hok Wai ponds",
            "status": "alert",
        },
    }
    assert watch_message(row) == (
        "Hoo Hok Wai ponds · 30 Sep 2026: water index -0.21 (usual -0.05 to 0.10), "
        "2.4 ha changed since 2 Jun 2026. Condition met. Tap to see the evidence."
    )
