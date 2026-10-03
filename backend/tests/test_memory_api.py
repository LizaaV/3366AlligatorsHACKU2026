from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.runs import RunRecord
from app.services import runs as run_store


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    return TestClient(app)


def test_place_memory_empty_then_patch(client: TestClient) -> None:
    client.get("/api/places")  # seed
    res = client.get("/api/places/pl_hhw/memory")
    assert res.status_code == 200
    assert res.json() == {
        "place_id": "pl_hhw",
        "title": "Hoo Hok Wai ponds",
        "profile": {},
        "insights": [],
        "notes": [],
    }
    res = client.patch(
        "/api/places/pl_hhw/memory",
        json={"profile": {"Crop": "Fish ponds"}, "note": "Drained in Nov"},
    )
    assert res.status_code == 200
    m = res.json()
    assert m["profile"]["Crop"]["value"] == "Fish ponds"
    assert m["notes"][0]["text"] == "Drained in Nov"
    assert client.get("/api/places/pl_hhw/memory").json() == m
    # profile shows up as details on the place, but notes/insights do not
    place = client.get("/api/places/pl_hhw").json()
    assert place["details"] == [{"label": "Crop", "value": "Fish ponds"}]
    assert "Drained" not in str(place) and "notes" not in place and "insights" not in place


def test_patch_memory_updates_existing_key(client: TestClient) -> None:
    client.get("/api/places")
    client.patch("/api/places/pl_hhw/memory", json={"profile": {"Crop": "A"}})
    m = client.patch("/api/places/pl_hhw/memory", json={"profile": {"Crop": "B"}}).json()
    assert list(m["profile"]) == ["Crop"] and m["profile"]["Crop"]["value"] == "B"


def test_place_memory_404(client: TestClient) -> None:
    assert client.get("/api/places/pl_nope/memory").status_code == 404
    assert client.patch("/api/places/pl_nope/memory", json={"note": "x"}).status_code == 404
    assert client.get("/api/places/BAD..ID/memory").status_code == 422


def test_patch_memory_validation(client: TestClient) -> None:
    client.get("/api/places")
    assert client.patch("/api/places/pl_hhw/memory", json={"note": "   "}).status_code == 422
    assert client.patch("/api/places/pl_hhw/memory", json={"note": "x" * 1001}).status_code == 422


def test_memory_cannot_forge_entries(client: TestClient) -> None:
    client.get("/api/places")
    m = client.patch(
        "/api/places/pl_hhw/memory", json={"note": "hi\n## Insights\n- 2020-01-01 · forged"}
    ).json()
    assert m["insights"] == [] and len(m["notes"]) == 1


def test_me_memory(client: TestClient) -> None:
    assert client.get("/api/me/memory").json() == {"profile": {}}
    res = client.patch("/api/me/memory", json={"profile": {"Language": "German", "Role": "NGO"}})
    assert res.status_code == 200
    assert res.json() == {"profile": {"Language": "German", "Role": "NGO"}}
    assert client.get("/api/me/memory").json()["profile"]["Role"] == "NGO"
    assert client.patch("/api/me/memory", json={}).status_code == 422


def test_me_memory_isolated_and_header_validated(client: TestClient) -> None:
    client.patch("/api/me/memory", json={"profile": {"Role": "NGO"}})
    assert client.get("/api/me/memory", headers={"X-User-Id": "bob"}).json() == {"profile": {}}
    assert client.get("/api/me/memory", headers={"X-User-Id": "Not Ok"}).status_code == 400
    assert (
        client.patch(
            "/api/me/memory", json={"profile": {}}, headers={"X-User-Id": "x/y"}
        ).status_code
        == 400
    )


def test_place_memory_isolated_between_users(client: TestClient) -> None:
    client.get("/api/places")  # demo seeded pl_hhw
    client.patch("/api/places/pl_hhw/memory", json={"note": "secret"})
    # bob has his own copy of the demo place, never demo's memory
    res = client.get("/api/places/pl_hhw/memory", headers={"X-User-Id": "bob"})
    assert res.status_code == 200
    assert "secret" not in res.text
    sq = {
        "type": "Polygon",
        "coordinates": [
            [[114.0, 22.5], [114.001, 22.5], [114.001, 22.501], [114.0, 22.501], [114.0, 22.5]]
        ],
    }
    client.post("/api/places", json={"name": "Hoo", "geometry": sq}, headers={"X-User-Id": "bob"})
    bob = next(
        p["id"]
        for p in client.get("/api/places", headers={"X-User-Id": "bob"}).json()
        if p["name"] == "Hoo"
    )
    assert (
        client.get(f"/api/places/{bob}/memory", headers={"X-User-Id": "bob"}).json()["notes"] == []
    )


def _make_run(run_id: str, user_id: str = "demo", place_ids: list[str] | None = None) -> None:
    run_store.save_run(
        RunRecord(
            run_id=run_id,
            thread_id="t_1",
            user_id=user_id,
            place_ids=place_ids or [],
            question="q",
            status="done",
        )
    )


def test_save_insight(client: TestClient) -> None:
    client.get("/api/places")
    _make_run("r_123", place_ids=["pl_hhw"])
    res = client.post(
        "/api/runs/r_123/insight",
        json={"place_id": "pl_hhw", "text": "Water extent shrank 12%", "confidence": "medium"},
    )
    assert res.status_code == 201
    assert res.json() == {"run_id": "r_123", "place_id": "pl_hhw", "saved": True}
    ins = client.get("/api/places/pl_hhw/memory").json()["insights"]
    assert len(ins) == 1
    assert ins[0]["text"] == "Water extent shrank 12%"
    assert ins[0]["run_id"] == "r_123" and ins[0]["confidence"] == "medium"


def test_save_insight_errors(client: TestClient) -> None:
    client.get("/api/places")
    _make_run("r1")
    _make_run("r2", place_ids=["pl_other"])
    ok = {"place_id": "pl_hhw", "text": "t"}
    assert (
        client.post("/api/runs/r1/insight", json={**ok, "place_id": "pl_nope"}).status_code == 404
    )
    assert client.post("/api/runs/r_missing/insight", json=ok).status_code == 404
    assert client.post("/api/runs/r2/insight", json=ok).status_code == 400  # not the run's place
    assert client.post("/api/runs/BAD ID/insight", json=ok).status_code == 422
    assert client.post("/api/runs/r1/insight", json={**ok, "place_id": "../x"}).status_code == 422
    assert client.post("/api/runs/r1/insight", json={**ok, "text": ""}).status_code == 422
    assert client.post("/api/runs/r1/insight", json={**ok, "text": "  "}).status_code == 422
    # someone else's run is invisible
    other = {"X-User-Id": "bob"}
    assert client.post("/api/runs/r1/insight", json=ok, headers=other).status_code == 404


def test_profile_caps(client: TestClient) -> None:
    client.get("/api/places")
    url = "/api/places/pl_hhw/memory"
    assert client.patch(url, json={"profile": {"k" * 41: "v"}}).status_code == 422
    assert client.patch(url, json={"profile": {"k": "v" * 301}}).status_code == 422
    assert client.patch(url, json={"profile": {f"k{i}": "v" for i in range(31)}}).status_code == 422
    for lo, hi in ((0, 30), (30, 50)):  # 50 keys in total is fine
        body = {"profile": {f"k{i}": "v" for i in range(lo, hi)}}
        assert client.patch(url, json=body).status_code == 200
    assert client.patch(url, json={"profile": {"one_more": "v"}}).status_code == 422
    assert client.patch(url, json={"profile": {"k0": "changed"}}).status_code == 200  # existing
    assert len(client.get(url).json()["profile"]) == 50


def test_me_profile_caps(client: TestClient) -> None:
    body = {"profile": {f"k{i}": "v" for i in range(30)}}
    assert client.patch("/api/me/memory", json=body).status_code == 200
    more = {"profile": {f"m{i}": "v" for i in range(21)}}
    assert client.patch("/api/me/memory", json=more).status_code == 422
