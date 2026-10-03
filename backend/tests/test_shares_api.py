"""Share links (BUILD-PLAN M6). Offline: EARTH_IMPL=stub."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import layers, runs, shares
from app.schemas.stream import ClarificationNeeded, ClarificationQuestion, ValueSource
from app.services import runs as run_store
from app.services import shares as share_store

ALICE = {"X-User-Id": "alice"}
BOB = {"X-User-Id": "bob"}
SECRET = "SECRET-MEMORY-TEXT-fish-farm-owner"


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("EARTH_IMPL", "stub")
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("RUNS_DB_PATH", str(tmp_path / "runs.sqlite"))
    app = FastAPI()
    for mod in (runs, layers, shares):
        app.include_router(mod.router, prefix="/api")
    with TestClient(app) as c:
        yield c


def _make_run(client: TestClient, headers: dict[str, str] = ALICE) -> str:
    res = client.post(
        "/api/runs", json={"question": "Have these ponds been filled in?"}, headers=headers
    )
    assert res.status_code == 200
    for chunk in res.text.replace("\r\n", "\n").split("\n\n"):
        if "run_started" in chunk:
            line = next(x for x in chunk.split("\n") if x.startswith("data:"))
            return json.loads(line[5:])["run_id"]
    raise AssertionError("no run_started")


def _share(client: TestClient, run_id: str, headers: dict[str, str] = ALICE) -> dict:
    res = client.post(f"/api/runs/{run_id}/share", headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def test_create_and_read_without_login(client: TestClient) -> None:
    run_id = _make_run(client)
    share = _share(client, run_id)
    assert len(share["slug"]) >= 22 and share["url"].endswith("/proof/" + share["slug"])
    assert share["url"].startswith("http://localhost:5173/")
    res = client.get(f"/api/shares/{share['slug']}")  # no X-User-Id: public
    assert res.status_code == 200
    body = res.json()
    assert body["question"] == "Have these ponds been filled in?"
    assert body["answer"]["title"] and body["blocks"] and body["steps"] and body["provenance"]
    assert body["method"]["cards"] and body["area"]["name"]
    assert body["expires_at"] > body["shared_at"]
    # layer images in shared blocks are served without an owner
    then_now = next(b for b in body["blocks"] if b["type"] == "then_now")
    assert client.get(then_now["after"]["url"]).status_code == 200


def test_owner_only(client: TestClient) -> None:
    run_id = _make_run(client)
    assert client.post(f"/api/runs/{run_id}/share", headers=BOB).status_code == 404
    assert client.post(f"/api/runs/{run_id}/share").status_code == 404  # "demo"
    assert client.post("/api/runs/r_nope/share", headers=ALICE).status_code == 404
    assert client.post("/api/runs/BAD!/share", headers=ALICE).status_code == 400
    slug = _share(client, run_id)["slug"]
    assert client.delete(f"/api/shares/{slug}", headers=BOB).status_code == 404
    assert client.get(f"/api/shares/{slug}").status_code == 200  # still alive
    assert client.get(f"/api/runs/{run_id}/shares", headers=BOB).status_code == 404


def test_unfinished_run_cannot_be_shared(client: TestClient) -> None:
    run_id = _make_run(client)
    run_store.update_status(run_id, "waiting_user")
    assert client.post(f"/api/runs/{run_id}/share", headers=ALICE).status_code == 409


def test_unknown_slug_is_404(client: TestClient) -> None:
    assert client.get("/api/shares/nope").status_code == 404


def test_snapshot_is_isolated_from_later_changes(client: TestClient) -> None:
    run_id = _make_run(client)
    slug = _share(client, run_id)["slug"]
    before = client.get(f"/api/shares/{slug}").json()
    run = run_store.get_run(run_id)
    assert run is not None
    run.question = "A different question"
    run.blocks = []
    run.answer = None
    run_store.save_run(run)
    assert client.get(f"/api/shares/{slug}").json() == before
    # a new share after the change sees the change
    new = _share(client, run_id)["slug"]
    assert client.get(f"/api/shares/{new}").json()["question"] == "A different question"


def test_expiry_gives_410(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    run_id = _make_run(client)
    share = _share(client, run_id)
    real_now = share_store._now
    monkeypatch.setattr(share_store, "_now", lambda: real_now() + timedelta(days=29))
    assert client.get(f"/api/shares/{share['slug']}").status_code == 200
    monkeypatch.setattr(share_store, "_now", lambda: real_now() + timedelta(days=31))
    res = client.get(f"/api/shares/{share['slug']}")
    assert res.status_code == 410 and "expired" in res.json()["detail"]


def test_settings_drive_ttl_and_url(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(share_store.settings, "share_ttl_days", 1)
    monkeypatch.setattr(share_store.settings, "public_base_url", "https://earth.example/")
    run_id = _make_run(client)
    share = _share(client, run_id)
    assert share["url"] == f"https://earth.example/proof/{share['slug']}"
    real_now = share_store._now
    monkeypatch.setattr(share_store, "_now", lambda: real_now() + timedelta(days=2))
    assert client.get(f"/api/shares/{share['slug']}").status_code == 410


def test_revoke(client: TestClient) -> None:
    run_id = _make_run(client)
    slug = _share(client, run_id)["slug"]
    other = _share(client, run_id)["slug"]
    assert client.delete(f"/api/shares/{slug}", headers=ALICE).status_code == 204
    assert client.get(f"/api/shares/{slug}").status_code == 410
    assert client.delete(f"/api/shares/{slug}", headers=ALICE).status_code == 204  # idempotent
    assert client.get(f"/api/shares/{other}").status_code == 200
    listed = client.get(f"/api/runs/{run_id}/shares", headers=ALICE).json()
    assert {s["slug"]: s["revoked"] for s in listed} == {slug: True, other: False}
    assert client.delete("/api/shares/nope", headers=ALICE).status_code == 404


def test_nothing_private_in_shared_json(client: TestClient) -> None:
    run_id = _make_run(client)
    run = run_store.get_run(run_id)
    assert run is not None
    # memory-prefilled clarification answers live in params, the event log and maybe the script
    run.params = {"answers": {"crop": SECRET}, "note": SECRET}
    run.script = f"def run(**p):\n    return {{'x': '{SECRET}'}}\n"
    run.events.append(
        ClarificationNeeded(
            questions=[
                ClarificationQuestion(
                    key="crop",
                    label="Crop?",
                    options=[],
                    value=SECRET,
                    source=ValueSource(**{"from": "memory"}, saved="2026-09-12"),
                )
            ],
            remember=True,
        )
    )
    run_store.save_run(run)
    slug = _share(client, run_id)["slug"]
    text = client.get(f"/api/shares/{slug}").text
    assert SECRET not in text
    for forbidden in ("user_id", "thread_id", '"events"', '"params"', '"script"', run.thread_id):
        assert forbidden not in text, forbidden
    assert '"alice"' not in text
    with sqlite3.connect(run_store.db_path()) as conn:
        stored = " ".join(r[0] for r in conn.execute("SELECT snapshot_json FROM shares"))
    assert SECRET not in stored and "alice" not in stored
