import json
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import watches as svc

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / "docs/data/watch-feasibility.example.json").read_text())["cases"]
CATS = [c["key"] for c in json.loads((ROOT / "docs/data/categories.json").read_text())]

SMALL = {  # ~0.25 ha
    "type": "Polygon",
    "coordinates": [
        [
            [114.09, 22.53],
            [114.0905, 22.53],
            [114.0905, 22.5305],
            [114.09, 22.5305],
            [114.09, 22.53],
        ]
    ],
}
FIELD = {  # ~11 ha
    "type": "Polygon",
    "coordinates": [
        [
            [114.09, 22.53],
            [114.0915, 22.53],
            [114.0915, 22.5315],
            [114.09, 22.5315],
            [114.09, 22.53],
        ]
    ],
}
BODY = {
    "name": "Dry patches · North Pivot",
    "category_key": "agriculture",
    "skill_id": "dry-patch-finder",
    "question": "Where are the dry patches in my field?",
    "condition": "Any notable change since the last pass",
    "channels": ["email"],
    "cadence": "Every pass (5 days)",
}


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    return TestClient(app)


def _place(client: TestClient, geometry: dict = FIELD) -> str:
    res = client.post("/api/places", json={"name": "North Pivot", "geometry": geometry})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _create(client: TestClient, **extra: object) -> dict:
    res = client.post("/api/watches", json={**BODY, **extra})
    assert res.status_code == 201, res.text
    return res.json()


# --- CRUD -----------------------------------------------------------------------------------


def test_empty_list_no_fake_seed(client: TestClient) -> None:
    res = client.get("/api/watches")
    assert res.status_code == 200
    assert res.json() == []


def test_create_and_list(client: TestClient) -> None:
    pid = _place(client)
    w = _create(client, place_id=pid)
    assert w["id"].startswith("w_")
    assert w["place_id"] == pid
    assert w["channels"] == ["email"]
    assert w["cadence"] == "Every pass (5 days)"
    assert w["enabled"] is True
    assert w["metric"] == "Dry area" and w["tier"] == "free" and w["confidence"] == "Medium"
    # Nothing measured yet: honest empties, not invented numbers.
    assert w["value"] is None and w["ci"] is None and w["baseline"] is None
    assert w["status"] is None and w["last_run_at"] is None and w["next_run_at"] is None
    assert w["series"] == {
        "unit": "",
        "labels": [],
        "current": [],
        "band_low": [],
        "band_high": [],
        "mean": [],
    }
    assert [e["level"] for e in w["events"]] == ["info"]
    datetime.fromisoformat(w["created_at"])
    second = _create(client, name="Second")
    assert [x["id"] for x in client.get("/api/watches").json()] == [second["id"], w["id"]]


def test_per_user(client: TestClient) -> None:
    _create(client)
    assert client.get("/api/watches", headers={"X-User-Id": "alice"}).json() == []


def test_create_unknown_place_404(client: TestClient) -> None:
    res = client.post("/api/watches", json={**BODY, "place_id": "pl_nope"})
    assert res.status_code == 404


@pytest.mark.parametrize(
    "patch",
    [
        {"channels": ["fax"]},
        {"name": ""},
        {"question": ""},
        {"place_id": "Bad Id!"},
        {"surprise": 1},
    ],
)
def test_create_422(client: TestClient, patch: dict) -> None:
    assert client.post("/api/watches", json={**BODY, **patch}).status_code == 422


def test_create_refused_question_422(client: TestClient) -> None:
    res = client.post("/api/watches", json={**BODY, "question": "count the cars in the lot"})
    assert res.status_code == 422
    assert res.json()["detail"]["ok"] is False
    assert client.get("/api/watches").json() == []


def test_create_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(svc, "MAX_WATCHES_PER_USER", 1)
    _create(client)
    assert client.post("/api/watches", json=BODY).status_code == 422


def test_channels_deduped(client: TestClient) -> None:
    assert _create(client, channels=["sms", "sms", "push"])["channels"] == ["sms", "push"]


def test_patch(client: TestClient) -> None:
    w = _create(client)
    res = client.patch(
        f"/api/watches/{w['id']}",
        json={"enabled": False, "name": "Renamed", "channels": ["slack"], "cadence": "Daily"},
    )
    assert res.status_code == 200
    got = res.json()
    assert got["enabled"] is False and got["name"] == "Renamed"
    assert got["channels"] == ["slack"] and got["cadence"] == "Daily"
    assert got["condition"] == BODY["condition"]  # untouched
    assert got["events"][0]["text"] == "Paused."
    assert got["next_run_at"] is None
    res = client.patch(f"/api/watches/{w['id']}", json={"enabled": True, "condition": "x"})
    assert res.json()["events"][0]["text"] == "Resumed."
    assert client.get("/api/watches").json()[0]["condition"] == "x"


def test_patch_404(client: TestClient) -> None:
    assert client.patch("/api/watches/w_missing", json={"enabled": False}).status_code == 404
    assert client.patch("/api/watches/BAD!", json={"enabled": False}).status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"enabled": "maybe"},
        {"enabled": None},
        {"name": None},
        {"name": ""},
        {"channels": ["pigeon"]},
        {"place_id": None},
        {"question": "new"},
    ],
)
def test_patch_422(client: TestClient, body: dict) -> None:
    w = _create(client)
    assert client.patch(f"/api/watches/{w['id']}", json=body).status_code == 422
    assert client.get("/api/watches").json()[0] == w  # nothing changed


def test_delete(client: TestClient) -> None:
    w = _create(client)
    assert client.delete(f"/api/watches/{w['id']}").status_code == 204
    assert client.get("/api/watches").json() == []
    assert client.delete(f"/api/watches/{w['id']}").status_code == 404
    assert client.get(f"/api/watches/{w['id']}/proof").status_code == 404


def test_other_user_cannot_touch(client: TestClient) -> None:
    w = _create(client)
    alice = {"X-User-Id": "alice"}
    assert (
        client.patch(f"/api/watches/{w['id']}", json={"enabled": False}, headers=alice).status_code
        == 404
    )
    assert client.delete(f"/api/watches/{w['id']}", headers=alice).status_code == 404
    assert client.get(f"/api/watches/{w['id']}/proof", headers=alice).status_code == 404


def test_proof_empty_until_run(client: TestClient) -> None:
    w = _create(client)
    res = client.get(f"/api/watches/{w['id']}/proof")
    assert res.status_code == 200
    assert res.json() == {"scenes": [], "hash": ""}
    assert client.get("/api/watches/w_missing/proof").status_code == 404


def test_deleting_place_detaches_watches(client: TestClient) -> None:
    pid = _place(client)
    w = _create(client, place_id=pid)
    other = _create(client, name="General")
    assert client.delete(f"/api/places/{pid}").status_code == 204
    by_id = {x["id"]: x for x in client.get("/api/watches").json()}
    assert by_id[w["id"]]["place_id"] is None
    assert "Place deleted" in by_id[w["id"]]["events"][0]["text"]
    assert by_id[other["id"]] == other


# --- feasibility ----------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=[c["request"]["text"] for c in CASES])
def test_feasibility_matches_examples(client: TestClient, case: dict) -> None:
    res = client.post("/api/watches/feasibility", json=case["request"])
    assert res.status_code == 200, res.text
    got, want = res.json(), case["response"]
    assert got["ok"] is want["ok"]
    assert got["partial"] is want.get("partial", False)
    assert got["title"] == want["title"]
    assert got["skill_id"] == want["skillId"]
    assert got["category_key"] == CATS[want["cat"]]
    assert got["tier"] == want["tier"]
    assert got["confidence"] == want["confidence"]
    assert got["satellites"] == want["sat"]
    assert got["notes"] == want["notes"]
    assert got.get("alternative") == want.get("alternative")


@pytest.mark.parametrize(
    "text",
    [
        "track my neighbour's car",
        "how many trucks enter the quarry",
        "identify the people at the gate",
        "read the license plates in the car park",
        "who is walking on my land",
    ],
)
def test_feasibility_refusals(client: TestClient, text: str) -> None:
    got = client.post("/api/watches/feasibility", json={"text": text}).json()
    assert got["ok"] is False and got["partial"] is False
    assert got["alternative"]
    assert any("individuals" in n for n in got["notes"])


@pytest.mark.parametrize(
    "text",
    [
        "Are the ponds being filled in?",
        "Is the pond water level dropping?",
        "tell me if the fish ponds lose water",
    ],
)
def test_feasibility_ponds_use_the_pond_skill(client: TestClient, text: str) -> None:
    got = client.post("/api/watches/feasibility", json={"text": text}).json()
    assert got["ok"] is True and got["partial"] is False
    assert got["skill_id"] == "pond-filling-check"
    assert got["category_key"] == "water"


def test_feasibility_unknown_is_not_ok(client: TestClient) -> None:
    got = client.post(
        "/api/watches/feasibility", json={"text": "what's the meaning of life"}
    ).json()
    assert got["ok"] is False and got["alternative"]


def test_feasibility_small_place_is_partial(client: TestClient) -> None:
    small = _place(client, SMALL)
    big = _place(client, FIELD)
    text = "where are the dry patches in my field"
    got = client.post("/api/watches/feasibility", json={"text": text, "place_id": small}).json()
    assert got["ok"] is True and got["partial"] is True and got["tier"] == "paid"
    assert "/ month" in got["cost"]
    got = client.post("/api/watches/feasibility", json={"text": text, "place_id": big}).json()
    assert got["partial"] is False and got["skill_id"] == "dry-patch-finder"


def test_feasibility_404_and_422(client: TestClient) -> None:
    url = "/api/watches/feasibility"
    assert client.post(url, json={"text": "fire", "place_id": "pl_nope"}).status_code == 404
    assert client.post(url, json={"text": ""}).status_code == 422
    assert client.post(url, json={"text": "x" * 501}).status_code == 422
    assert client.post(url, json={}).status_code == 422
