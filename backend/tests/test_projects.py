"""Chat projects: folders of conversations, stored per user. Offline (threads are saved runs)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import projects as projects_routes
from app.api.routes import threads as threads_routes
from app.schemas.runs import RunRecord
from app.services import projects as project_store
from app.services import runs as run_store

ALICE = {"X-User-Id": "alice"}
BOB = {"X-User-Id": "bob"}


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("EARTH_IMPL", "stub")
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("RUNS_DB_PATH", str(tmp_path / "runs.sqlite"))
    app = FastAPI()
    app.include_router(projects_routes.router, prefix="/api")
    app.include_router(threads_routes.router, prefix="/api")
    with TestClient(app) as c:
        yield c


def _thread(thread_id: str, user: str = "alice") -> None:
    run_store.save_run(
        RunRecord(
            run_id=f"r_{thread_id}",
            thread_id=thread_id,
            user_id=user,
            question="Where is it dry?",
            status="done",
        )
    )


def _create(client: TestClient, name: str = "Ponds", headers: dict[str, str] = ALICE) -> dict:
    r = client.post("/api/projects", json={"name": name}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _summary(client: TestClient, thread_id: str, user: dict[str, str] = ALICE) -> dict:
    rows = client.get("/api/threads", headers=user).json()
    return next(t for t in rows if t["thread_id"] == thread_id)


def test_create_list_rename_delete(client: TestClient) -> None:
    assert client.get("/api/projects", headers=ALICE).json() == []
    a = _create(client, "  Ponds  ")
    b = _create(client, "Fires")
    assert a["name"] == "Ponds" and a["id"].startswith("prj_")
    assert set(a) == {"id", "name", "created_at", "updated_at"}

    assert [p["name"] for p in client.get("/api/projects", headers=ALICE).json()] == [
        "Ponds",
        "Fires",
    ]

    r = client.patch(f"/api/projects/{a['id']}", json={"name": "Dry ponds"}, headers=ALICE)
    assert r.status_code == 200 and r.json()["name"] == "Dry ponds"
    assert r.json()["updated_at"] >= a["updated_at"]

    assert client.delete(f"/api/projects/{b['id']}", headers=ALICE).status_code == 204
    assert [p["id"] for p in client.get("/api/projects", headers=ALICE).json()] == [a["id"]]


def test_name_validation_and_cap(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    for bad in ("", "   ", "x" * 61):
        assert client.post("/api/projects", json={"name": bad}, headers=ALICE).status_code == 422
    assert _create(client, "x" * 60)["name"] == "x" * 60
    assert client.patch("/api/projects/prj_x", json={"name": ""}, headers=ALICE).status_code == 422

    monkeypatch.setattr(project_store, "MAX_PROJECTS_PER_USER", 3)
    _create(client, "two")
    _create(client, "three")
    r = client.post("/api/projects", json={"name": "four"}, headers=ALICE)
    assert r.status_code == 422
    assert _create(client, "other user", BOB)  # the cap is per user


def test_unknown_project_is_404(client: TestClient) -> None:
    assert (
        client.patch("/api/projects/prj_nope", json={"name": "x"}, headers=ALICE).status_code == 404
    )
    assert client.delete("/api/projects/prj_nope", headers=ALICE).status_code == 404
    assert client.delete("/api/projects/BAD ID", headers=ALICE).status_code in (400, 404)


def test_assign_and_unassign(client: TestClient) -> None:
    _thread("t_one")
    p = _create(client)
    assert _summary(client, "t_one")["project_id"] is None

    r = client.patch("/api/threads/t_one", json={"project_id": p["id"]}, headers=ALICE)
    assert r.status_code == 200
    assert r.json()["project_id"] == p["id"] and r.json()["thread_id"] == "t_one"
    assert _summary(client, "t_one")["project_id"] == p["id"]
    assert client.get("/api/threads/t_one", headers=ALICE).json()["project_id"] == p["id"]

    q = _create(client, "Fires")  # moving between projects replaces the assignment
    r = client.patch("/api/threads/t_one", json={"project_id": q["id"]}, headers=ALICE)
    assert r.json()["project_id"] == q["id"]

    r = client.patch("/api/threads/t_one", json={"project_id": None}, headers=ALICE)
    assert r.status_code == 200 and r.json()["project_id"] is None
    assert _summary(client, "t_one")["project_id"] is None


def test_assign_404s(client: TestClient) -> None:
    _thread("t_one")
    p = _create(client)
    r = client.patch("/api/threads/t_missing", json={"project_id": p["id"]}, headers=ALICE)
    assert r.status_code == 404
    r = client.patch("/api/threads/t_one", json={"project_id": "prj_nope"}, headers=ALICE)
    assert r.status_code == 404
    assert _summary(client, "t_one")["project_id"] is None


def test_delete_project_unfiles_chats_but_keeps_them(client: TestClient) -> None:
    _thread("t_one")
    _thread("t_two")
    p = _create(client)
    other = _create(client, "Other")
    client.patch("/api/threads/t_one", json={"project_id": p["id"]}, headers=ALICE)
    client.patch("/api/threads/t_two", json={"project_id": other["id"]}, headers=ALICE)

    assert client.delete(f"/api/projects/{p['id']}", headers=ALICE).status_code == 204
    rows = {t["thread_id"]: t for t in client.get("/api/threads", headers=ALICE).json()}
    assert set(rows) == {"t_one", "t_two"}
    assert rows["t_one"]["project_id"] is None
    assert rows["t_two"]["project_id"] == other["id"]


def test_users_are_isolated(client: TestClient) -> None:
    _thread("t_alice", "alice")
    _thread("t_bob", "bob")
    p = _create(client, "Mine", ALICE)

    assert client.get("/api/projects", headers=BOB).json() == []
    assert (
        client.patch(f"/api/projects/{p['id']}", json={"name": "x"}, headers=BOB).status_code == 404
    )
    assert client.delete(f"/api/projects/{p['id']}", headers=BOB).status_code == 404
    # Bob cannot file his chat in Alice's project, nor touch Alice's chat.
    r = client.patch("/api/threads/t_bob", json={"project_id": p["id"]}, headers=BOB)
    assert r.status_code == 404
    r = client.patch("/api/threads/t_alice", json={"project_id": None}, headers=BOB)
    assert r.status_code == 404

    client.patch("/api/threads/t_alice", json={"project_id": p["id"]}, headers=ALICE)
    assert _summary(client, "t_bob", BOB)["project_id"] is None
    assert [p["name"] for p in client.get("/api/projects", headers=ALICE).json()] == ["Mine"]
