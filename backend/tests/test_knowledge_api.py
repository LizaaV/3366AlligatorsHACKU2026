"""Tests for the read-only /api/knowledge endpoints."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import knowledge

# Mount the router directly so the test does not depend on app/api/router.py wiring.
_app = FastAPI()
_app.include_router(knowledge.router, prefix="/api")
client = TestClient(_app)


def test_index_lists_events_and_settings() -> None:
    res = client.get("/api/knowledge/index")
    assert res.status_code == 200
    data = res.json()
    types = [e["type"] for e in data]
    assert types.count("event") == 11
    assert types.count("setting") == 13
    first = data[0]
    assert set(first) == {"id", "type", "name", "summary", "status", "version", "aliases"}


def test_card_detail_includes_body_markdown() -> None:
    res = client.get("/api/knowledge/cards/pond_filling")
    assert res.status_code == 200
    data = res.json()
    assert data["entry"]["id"] == "pond_filling"
    assert data["entry"]["type"] == "event"
    assert data["header"]["id"] == "pond_filling"
    assert "signs" in data["header"]
    assert "## What it is" in data["body_markdown"]


def test_unknown_card_is_404() -> None:
    res = client.get("/api/knowledge/cards/not_a_card")
    assert res.status_code == 404


def test_bad_card_id_is_400() -> None:
    assert client.get("/api/knowledge/cards/Pond-Filling").status_code == 400
    assert client.get("/api/knowledge/cards/..%2Fpolicy").status_code in (400, 404)
    assert client.get("/api/knowledge/cards/" + "a" * 65).status_code in (400, 422)


def test_find_returns_water_gain() -> None:
    res = client.get("/api/knowledge/find", params={"q": "were there floods here"})
    assert res.status_code == 200
    ids = [e["id"] for e in res.json()]
    assert "water_gain" in ids


def test_find_rejects_long_query() -> None:
    assert client.get("/api/knowledge/find", params={"q": "x" * 501}).status_code == 422


def test_policy_not_exposed() -> None:
    assert client.get("/api/knowledge/cards/rules").status_code == 404
    assert client.get("/api/knowledge/policy").status_code == 404
    ids = {e["id"] for e in client.get("/api/knowledge/index").json()}
    assert "rules" not in ids and "tests" not in ids
