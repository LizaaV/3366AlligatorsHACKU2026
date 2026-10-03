"""Dashboards (BUILD-PLAN M8). Offline: EARTH_IMPL=stub; refresh runs the real sandbox."""

from __future__ import annotations

import ast
from collections.abc import Iterator
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import earth
from app.api.routes import dashboards, runs
from app.schemas.runs import RunRecord
from app.services import dashboards as dash_service
from app.services import runs as run_store
from app.services.sandbox import RunOutcome, ScriptError, ScriptResult

ALICE = {"X-User-Id": "alice"}
BOB = {"X-User-Id": "bob"}
RUN_DATE = datetime(2026, 10, 3, 12, 0, tzinfo=UTC)

SCRIPT = """
import earth
from earth.presets import HOO_HOK_WAI

def run(**params):
    c = earth.compare(
        HOO_HOK_WAI, "bare", before=params["before"], after=params["after"]
    )
    return {
        "findings": {},
        "evidence": [],
        "blocks": [earth.show.stat("Area changed", c.changed_ha, "ha", id="b1")],
        "notes": [],
    }
"""
CRASH = "def run(**params):\n    raise RuntimeError('boom')\n"
SCAN_BAD = "import os\ndef run(**params):\n    return {}\n"
PARAMS = {"before": "2026-03-01", "after": "2026-10-03", "last": "60d"}


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("EARTH_IMPL", "stub")
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("RUNS_DB_PATH", str(tmp_path / "runs.sqlite"))
    app = FastAPI()
    app.include_router(runs.router, prefix="/api")
    app.include_router(dashboards.router, prefix="/api")
    with TestClient(app) as c:
        yield c


def _stat(value: float, id: str = "b1") -> Any:
    return earth.show.stat("Area changed", value, "ha", id=id)


def _save_run(script: str | None = SCRIPT, user: str = "alice", run_id: str = "r_dash01") -> str:
    run_store.save_run(
        RunRecord(
            run_id=run_id,
            thread_id="t_dash01",
            user_id=user,
            question="How much changed?",
            status="done",
            created_at=RUN_DATE,
            blocks=[_stat(12.5, "b1"), _stat(3.0, "b2")],
            script=script,
            params=dict(PARAMS),
        )
    )
    return run_id


def _dashboard(client: TestClient, headers: dict[str, str] = ALICE, name: str = "Ponds") -> str:
    res = client.post("/api/dashboards", json={"name": name}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _add(client: TestClient, dash: str, run_id: str, block: str = "b1", headers=ALICE):
    return client.post(
        f"/api/dashboards/{dash}/blocks",
        json={"run_id": run_id, "block_id": block},
        headers=headers,
    )


def test_crud_and_owner_isolation(client: TestClient) -> None:
    dash = _dashboard(client)
    assert client.get("/api/dashboards", headers=ALICE).json()[0] == {
        "id": dash,
        "name": "Ponds",
        "created_at": client.get(f"/api/dashboards/{dash}", headers=ALICE).json()["created_at"],
        "block_count": 0,
    }
    assert client.get("/api/dashboards", headers=BOB).json() == []
    for call in (client.get, client.delete):
        assert call(f"/api/dashboards/{dash}", headers=BOB).status_code == 404
    assert (
        client.patch(f"/api/dashboards/{dash}", json={"name": "x"}, headers=BOB).status_code == 404
    )
    res = client.patch(f"/api/dashboards/{dash}", json={"name": "  New name "}, headers=ALICE)
    assert res.status_code == 200 and res.json()["name"] == "New name"
    assert client.post("/api/dashboards", json={"name": " "}, headers=ALICE).status_code == 422
    assert client.get("/api/dashboards/BAD!", headers=ALICE).status_code == 400
    assert client.delete(f"/api/dashboards/{dash}", headers=ALICE).status_code == 204
    assert client.get(f"/api/dashboards/{dash}", headers=ALICE).status_code == 404


def test_save_block_copies_block_script_and_params(client: TestClient) -> None:
    run_id = _save_run()
    dash = _dashboard(client)
    res = _add(client, dash, run_id, "b2")
    assert res.status_code == 201, res.text
    saved = res.json()
    assert saved["block_id"].startswith("blk_") and saved["block"]["id"] == "b2"
    assert saved["block"]["value"] == 3.0
    assert saved["source"] == {
        "run_id": run_id,
        "run_date": "2026-10-03",
        "script": SCRIPT,
        "params": PARAMS,
        "block_index": 1,
        "block_id": "b2",
    }
    assert saved["caption"].startswith("Saved 3 Oct 2026: Area changed: 3 ha")
    assert client.get(f"/api/dashboards/{dash}", headers=ALICE).json()["blocks"] == [saved]


def test_save_block_errors(client: TestClient) -> None:
    run_id = _save_run()
    no_script = _save_run(script=None, run_id="r_dash02")
    other = _save_run(user="bob", run_id="r_dash03")
    dash = _dashboard(client)
    res = _add(client, dash, no_script)
    assert res.status_code == 422 and "no saved script" in res.json()["detail"]
    assert _add(client, dash, run_id, "nope").status_code == 404
    assert _add(client, dash, other).status_code == 404  # someone else's run
    assert _add(client, dash, "r_missing").status_code == 404
    assert _add(client, dash, run_id, headers=BOB).status_code == 404  # run not Bob's
    bob_dash = _dashboard(client, BOB)
    assert _add(client, bob_dash, run_id).status_code == 404  # dashboard not Alice's
    assert _add(client, "dash_missing", run_id).status_code == 404
    assert client.get(f"/api/dashboards/{dash}", headers=ALICE).json()["blocks"] == []


def test_refresh_reruns_script_in_sandbox(client: TestClient) -> None:
    run_id = _save_run()
    dash = _dashboard(client)
    saved = _add(client, dash, run_id).json()
    res = client.post(f"/api/dashboards/{dash}/blocks/{saved['block_id']}/refresh", headers=ALICE)
    assert res.status_code == 200, res.text
    fresh = res.json()
    assert fresh["block_id"] == saved["block_id"]
    assert fresh["block"]["type"] == "stat" and fresh["block"]["id"] == "b1"
    assert fresh["block"]["value"] != saved["block"]["value"]  # the stub's own number, not 12.5
    assert fresh["refreshed_at"] > saved["refreshed_at"]
    assert fresh["caption"].startswith("Refreshed ") and "Area changed:" in fresh["caption"]
    stored = client.get(f"/api/dashboards/{dash}", headers=ALICE).json()["blocks"]
    assert stored == [fresh]
    assert stored[0]["source"] == saved["source"]  # the saved recipe is not rewritten


def test_refresh_params_move_forward(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    async def fake(script: str, params: dict, run_id: str, on_call=None, timeout_s: int = 60):
        calls.append({"script": script, "params": params, "run_id": run_id, "t": timeout_s})
        block = _stat(99.0)
        return RunOutcome(
            ok=True,
            result=ScriptResult(findings={}, evidence=[], blocks=[block]),
            error=None,
            calls=[],
        )

    monkeypatch.setattr(dash_service, "run_script", fake)
    monkeypatch.setattr(dash_service, "_today", lambda: date(2026, 11, 20))
    run_id = _save_run()
    dash = _dashboard(client)
    block = _add(client, dash, run_id).json()["block_id"]
    res = client.post(f"/api/dashboards/{dash}/blocks/{block}/refresh", headers=ALICE)
    assert res.status_code == 200 and res.json()["block"]["value"] == 99.0
    assert "99 ha" in res.json()["caption"]
    (call,) = calls
    assert call["script"] == SCRIPT and call["t"] == 60
    assert call["run_id"].startswith("d_") and call["run_id"] != run_id
    # `after` was the run's date -> today; `before` and relative `last` unchanged
    assert call["params"] == {"before": "2026-03-01", "after": "2026-11-20", "last": "60d"}


def test_move_params_rule() -> None:
    today, run_date = date(2026, 11, 20), date(2026, 10, 3)
    move = dash_service.move_params
    assert move({"last": "60d", "years": 5}, run_date, today) == {"last": "60d", "years": 5}
    assert move({"after": "2026-10-03", "before": "2026-10-03"}, run_date, today) == {
        "after": "2026-11-20",
        "before": "2026-10-03",
    }
    assert move({"after": "2026-09-30"}, run_date, today) == {"after": "2026-09-30"}
    original = {"after": "2026-10-03"}
    move(original, run_date, today)
    assert original == {"after": "2026-10-03"}  # input not mutated


@pytest.mark.parametrize(
    ("script", "status", "kind"),
    [(CRASH, 502, "crash"), (SCAN_BAD, 422, "scan")],
)
def test_failed_refresh_keeps_old_block(
    client: TestClient, script: str, status: int, kind: str
) -> None:
    run_id = _save_run(script=script)
    dash = _dashboard(client)
    saved = _add(client, dash, run_id).json()
    res = client.post(f"/api/dashboards/{dash}/blocks/{saved['block_id']}/refresh", headers=ALICE)
    assert res.status_code == status, res.text
    detail = res.json()["detail"]
    assert detail["kind"] == kind and detail["message"]
    assert "traceback_tail" not in detail
    assert client.get(f"/api/dashboards/{dash}", headers=ALICE).json()["blocks"] == [saved]


def test_failed_refresh_reports_earth_error_and_hint(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake(*args, **kwargs):
        err = ScriptError(
            kind="crash",
            message="No clear scenes",
            hint="Extend last='90d'.",
            earth_kind="no_clear_scenes",
        )
        return RunOutcome(ok=False, result=None, error=err, calls=[])

    monkeypatch.setattr(dash_service, "run_script", fake)
    dash = _dashboard(client)
    saved = _add(client, dash, _save_run()).json()
    res = client.post(f"/api/dashboards/{dash}/blocks/{saved['block_id']}/refresh", headers=ALICE)
    assert res.status_code == 502
    assert res.json()["detail"]["earth_kind"] == "no_clear_scenes"
    assert res.json()["detail"]["hint"] == "Extend last='90d'."
    assert client.get(f"/api/dashboards/{dash}", headers=ALICE).json()["blocks"] == [saved]


def test_refresh_with_no_matching_block_keeps_old(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fake(*args, **kwargs):
        timeline_less = ScriptResult(findings={}, evidence=[], blocks=[])
        return RunOutcome(ok=True, result=timeline_less, error=None, calls=[])

    monkeypatch.setattr(dash_service, "run_script", fake)
    dash = _dashboard(client)
    saved = _add(client, dash, _save_run()).json()
    res = client.post(f"/api/dashboards/{dash}/blocks/{saved['block_id']}/refresh", headers=ALICE)
    assert res.status_code == 422 and "no longer produces" in res.json()["detail"]
    assert client.get(f"/api/dashboards/{dash}", headers=ALICE).json()["blocks"] == [saved]


def test_refresh_and_remove_are_owner_only(client: TestClient) -> None:
    dash = _dashboard(client)
    saved = _add(client, dash, _save_run()).json()
    url = f"/api/dashboards/{dash}/blocks/{saved['block_id']}"
    assert client.post(f"{url}/refresh", headers=BOB).status_code == 404
    assert client.delete(url, headers=BOB).status_code == 404
    assert (
        client.post(f"/api/dashboards/{dash}/blocks/blk_missing/refresh", headers=ALICE).status_code
        == 404
    )
    assert client.delete(url, headers=ALICE).status_code == 204
    assert client.delete(url, headers=ALICE).status_code == 404
    assert client.get(f"/api/dashboards/{dash}", headers=ALICE).json()["blocks"] == []


def test_dashboards_code_has_no_llm_dependency() -> None:
    """Refresh must stay LLM-free: none of the dashboards modules import an LLM or the agent."""
    app_dir = Path(dash_service.__file__).parents[1]
    files = [
        app_dir / "services" / "dashboards.py",
        app_dir / "api" / "routes" / "dashboards.py",
        app_dir / "schemas" / "dashboards.py",
    ]
    banned = ("anthropic", "openai", "llm", "agent", "langchain")
    for path in files:
        for node in ast.walk(ast.parse(path.read_text())):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or "", *(a.name for a in node.names)]
            for name in names:
                assert not any(b in name.lower() for b in banned), f"{path.name}: {name}"
