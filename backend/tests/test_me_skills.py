"""Installed skills: per-user, persisted, validated against the skills list."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import me_skills as me_routes
from app.api.routes import skills as skills_routes

ALICE = {"X-User-Id": "alice"}
BOB = {"X-User-Id": "bob"}
SKILL = "pond-filling-check"


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("EARTH_IMPL", "stub")
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("RUNS_DB_PATH", str(tmp_path / "runs.sqlite"))
    app = FastAPI()
    app.include_router(me_routes.router, prefix="/api")
    app.include_router(skills_routes.router, prefix="/api")
    with TestClient(app) as c:
        yield c


def test_starts_empty(client: TestClient) -> None:
    assert client.get("/api/me/skills", headers=ALICE).json() == {"installed": []}


def test_install_uninstall_roundtrip_and_idempotent(client: TestClient) -> None:
    for _ in range(2):
        r = client.put(f"/api/me/skills/{SKILL}", headers=ALICE)
        assert r.status_code == 200
        assert r.json() == {"installed": [SKILL]}
    assert client.get("/api/me/skills", headers=ALICE).json() == {"installed": [SKILL]}
    for _ in range(2):
        r = client.delete(f"/api/me/skills/{SKILL}", headers=ALICE)
        assert r.status_code == 200
        assert r.json() == {"installed": []}


def test_unknown_skill_404(client: TestClient) -> None:
    assert client.put("/api/me/skills/dry-patch-finder", headers=ALICE).status_code == 404
    assert client.get("/api/me/skills", headers=ALICE).json() == {"installed": []}


def test_bad_id_422(client: TestClient) -> None:
    assert client.put("/api/me/skills/Bad%20Id", headers=ALICE).status_code == 422


def test_scoped_per_user(client: TestClient) -> None:
    client.put(f"/api/me/skills/{SKILL}", headers=ALICE)
    assert client.get("/api/me/skills", headers=BOB).json() == {"installed": []}
