"""Trigger recurrence + dashboard link on watches, and GET /api/satellites (offline)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import satellites as sat_svc
from app.services import watches as watch_svc

ALICE = {"X-User-Id": "alice"}
BOB = {"X-User-Id": "bob"}
BODY = {
    "name": "Dry patches",
    "skill_id": "dry-patch-finder",
    "question": "Where are the dry patches in my field?",
}


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("RUNS_DB_PATH", str(tmp_path / "runs.sqlite"))
    return TestClient(app)


def _dash(client: TestClient, headers: dict[str, str] = ALICE) -> str:
    res = client.post("/api/dashboards", json={"name": "Ponds"}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def test_defaults(client: TestClient) -> None:
    w = client.post("/api/watches", json=BODY, headers=ALICE).json()
    assert w["recurrence"] == "recurring"
    assert w["dashboard_id"] is None


def test_create_with_recurrence_and_dashboard(client: TestClient) -> None:
    dash = _dash(client)
    res = client.post(
        "/api/watches",
        json={**BODY, "recurrence": "once", "dashboard_id": dash},
        headers=ALICE,
    )
    assert res.status_code == 201, res.text
    assert res.json()["recurrence"] == "once"
    assert res.json()["dashboard_id"] == dash
    listed = client.get("/api/watches", headers=ALICE).json()
    assert listed[0]["dashboard_id"] == dash


def test_dashboard_must_exist_and_belong_to_user(client: TestClient) -> None:
    other = _dash(client, BOB)
    for dash in ("d_nope0000", other):
        res = client.post("/api/watches", json={**BODY, "dashboard_id": dash}, headers=ALICE)
        assert res.status_code == 404
    bad = client.post("/api/watches", json={**BODY, "recurrence": "weekly"}, headers=ALICE)
    assert bad.status_code == 422


def test_patch_recurrence_and_dashboard(client: TestClient) -> None:
    w = client.post("/api/watches", json=BODY, headers=ALICE).json()
    dash = _dash(client)
    res = client.patch(
        f"/api/watches/{w['id']}",
        json={"recurrence": "once", "dashboard_id": dash},
        headers=ALICE,
    )
    assert res.status_code == 200, res.text
    assert res.json()["recurrence"] == "once"
    assert res.json()["dashboard_id"] == dash
    missing = client.patch(
        f"/api/watches/{w['id']}", json={"dashboard_id": "d_nope0000"}, headers=ALICE
    )
    assert missing.status_code == 404
    unlink = client.patch(f"/api/watches/{w['id']}", json={"dashboard_id": None}, headers=ALICE)
    assert unlink.json()["dashboard_id"] is None
    assert unlink.json()["recurrence"] == "once"
    null_rec = client.patch(f"/api/watches/{w['id']}", json={"recurrence": None}, headers=ALICE)
    assert null_rec.status_code == 422


def test_once_disables_after_first_alert_recurring_does_not(client: TestClient) -> None:
    once = client.post("/api/watches", json={**BODY, "recurrence": "once"}, headers=ALICE).json()
    rec = client.post("/api/watches", json=BODY, headers=ALICE).json()

    warn = watch_svc.record_event("alice", once["id"], "Getting dry", "warn")
    assert warn is not None and warn.enabled is True

    for wid, expect_enabled in ((once["id"], False), (rec["id"], True)):
        dto = watch_svc.record_event("alice", wid, "Dry area 8 ha", "alert")
        assert dto is not None
        assert dto.enabled is expect_enabled
        assert dto.events[0 if expect_enabled else 1].level == "alert"
    assert client.get("/api/watches", headers=ALICE).json()
    assert watch_svc.record_event("alice", "w_missing", "x", "alert") is None


# --- satellites --------------------------------------------------------------------------------

TLE = (
    "1 40697U 15028A   26276.32654622  .00000104  00000+0  56215-4 0  9992",
    "2 40697  98.5647 349.6023 0001073  88.9233 271.2073 14.30819568589197",
)


@pytest.fixture
def offline(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sat_svc, "fetch_tle", lambda norad_id: None)
    sat_svc._cache.clear()


def test_satellites_from_snapshot(client: TestClient, offline: None) -> None:
    res = client.get("/api/satellites")
    assert res.status_code == 200, res.text
    sats = res.json()
    ids = {s["id"] for s in sats}
    assert {"sentinel-1a", "sentinel-2a", "sentinel-2b", "landsat-8", "landsat-9"} <= ids
    assert {"terra", "aqua", "suomi-npp"} <= ids
    for s in sats:
        assert -90 <= s["lat"] <= 90 and -180 <= s["lon"] <= 180
        assert 600 < s["alt_km"] < 900
        assert 6.5 < s["velocity_kms"] < 8
        assert len(s["track"]) == 45
        assert s["track"][0]["lat"] == pytest.approx(s["lat"], abs=0.01)
    s2a = next(s for s in sats if s["id"] == "sentinel-2a")
    assert s2a["norad_id"] == 40697 and s2a["mission"] == "Sentinel-2"


def test_satellites_at_param_and_fetched_tle_is_cached(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[int] = []

    def fake_fetch(norad_id: int):
        calls.append(norad_id)
        return TLE if norad_id == 40697 else None

    monkeypatch.setattr(sat_svc, "fetch_tle", fake_fetch)
    sat_svc._cache.clear()
    at = "2026-10-04T12:00:00Z"
    first = client.get("/api/satellites", params={"at": at}).json()
    again = client.get("/api/satellites", params={"at": at}).json()
    assert first == again
    assert datetime.fromisoformat(first[0]["at"]) == datetime(2026, 10, 4, 12, tzinfo=UTC)
    assert calls.count(40697) == 1  # second request served from the 6 h cache
    later = client.get("/api/satellites", params={"at": "2026-10-04T12:30:00Z"}).json()
    a = next(s for s in first if s["id"] == "sentinel-2a")
    b = next(s for s in later if s["id"] == "sentinel-2a")
    assert (a["lat"], a["lon"]) != (b["lat"], b["lon"])
    assert client.get("/api/satellites", params={"at": "garbage"}).status_code == 422
