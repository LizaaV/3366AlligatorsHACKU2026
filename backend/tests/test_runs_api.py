"""Runs endpoints + preset stream + layers (BUILD-PLAN A1). Offline: EARTH_IMPL=stub."""

from __future__ import annotations

import asyncio
import json
import math
import sqlite3
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import earth
from app.api.routes import layers, runs
from app.schemas.areas import AreaResolveRequest
from app.schemas.runs import RunRecord, RunRequest
from app.schemas.stream import ClarificationNeeded, ClarificationQuestion
from app.services import preset_run
from app.services import runs as run_store
from earth import calls as earth_calls


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("EARTH_IMPL", "stub")
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("RUNS_DB_PATH", str(tmp_path / "runs.sqlite"))
    app = FastAPI()
    app.include_router(runs.router, prefix="/api")
    app.include_router(layers.router, prefix="/api")
    with TestClient(app) as c:
        yield c


def _events(text: str) -> list[tuple[str, dict]]:
    """Parse an SSE body into (event, data) pairs; comments (pings) are skipped."""
    out = []
    for chunk in text.replace("\r\n", "\n").split("\n\n"):
        name, data = None, []
        for line in chunk.split("\n"):
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
        if name:
            out.append((name, json.loads("\n".join(data))))
    return out


def _start(client: TestClient, headers: dict[str, str] | None = None, **body) -> list:
    res = client.post(
        "/api/runs", json={"question": "Have these ponds been filled in?", **body}, headers=headers
    )
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    return _events(res.text)


def test_stream_order_and_answer(client: TestClient) -> None:
    evs = _start(client)
    names = [n for n, _ in evs]
    assert names[:3] == ["run_started", "guard", "hypotheses_registered"]
    assert names[-1] == "done" and names.count("done") == 1
    assert names.index("answer") > names.index("block_ready") > names.index("step_finished")
    assert names.count("step_started") == names.count("step_finished") >= 5

    data = dict(evs)
    hyp = data["hypotheses_registered"]
    assert hyp["hypotheses"] == ["pond_filling", "water_loss", "seasonal"]
    assert hyp["post_hoc"] is False and hyp["expectation_table"]

    answer = data["answer"]["answer"]
    assert answer["preset"] is True and answer["measure_only"] is False
    assert answer["cause"] == "consistent with the ponds being filled in"
    assert answer["confidence"]["level"] == "Low"
    assert answer["caveats"]
    assert {b["type"] for b in answer["blocks"]} >= {"timeline", "then_now", "stat", "hypotheses"}
    assert {c["id"] for c in answer["method"]["cards"]} == {
        "pond_filling",
        "water_loss",
        "seasonal",
    }
    assert "demo" not in json.dumps(answer)
    assert data["done"]["status"] == "done"

    # every block image is served by the layers route
    then_now = next(b for b in answer["blocks"] if b["type"] == "then_now")
    img = client.get(then_now["after"]["url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"


def test_run_is_stored(client: TestClient) -> None:
    evs = _start(client)
    run_id = evs[0][1]["run_id"]
    res = client.get(f"/api/runs/{run_id}")
    assert res.status_code == 200
    rec = RunRecord.model_validate(res.json())
    assert rec.status == "done" and rec.user_id == "demo"
    assert rec.answer is not None and rec.blocks and rec.steps and rec.provenance
    assert [e.event for e in rec.events] == [n for n, _ in evs]
    assert rec.area is not None and rec.area.name
    assert rec.answer.title and rec.answer.kind == "place" and rec.answer.color
    # threads are A4's route, not registered here
    assert client.get(f"/api/threads/{rec.thread_id}").status_code == 404


def test_user_header_rules(client: TestClient) -> None:
    bad = client.post("/api/runs", json={"question": "x"}, headers={"X-User-Id": "Bad User!"})
    assert bad.status_code == 400
    evs = _start(client, headers={"X-User-Id": "alice"})
    run_id, thread_id = evs[0][1]["run_id"], evs[0][1]["thread_id"]
    assert client.get(f"/api/runs/{run_id}", headers={"X-User-Id": "alice"}).status_code == 200
    assert client.get(f"/api/runs/{run_id}").status_code == 404  # "demo"
    assert client.get(f"/api/runs/{run_id}", headers={"X-User-Id": "bob"}).status_code == 404
    # cannot continue someone else's thread
    res = client.post("/api/runs", json={"question": "Since when?", "thread_id": thread_id})
    assert res.status_code == 404
    # ...but can continue your own
    evs = _start(client, headers={"X-User-Id": "alice"}, thread_id=thread_id)
    assert evs[0][1]["thread_id"] == thread_id


def test_unknown_thread_id_is_404_not_claimed(client: TestClient) -> None:
    """Regression: a client-chosen thread id must not create (and so squat) a thread."""
    res = client.post("/api/runs", json={"question": "x", "thread_id": "t_mine"})
    assert res.status_code == 404
    assert run_store.list_runs("t_mine") == []


@pytest.mark.parametrize("header", ["_", "-me", "_x"])
def test_user_id_must_start_alphanumeric(client: TestClient, header: str) -> None:
    """Regression: ids memory rejects are rejected at the API, before any run is stored."""
    res = client.post("/api/runs", json={"question": "x"}, headers={"X-User-Id": header})
    assert res.status_code == 400


@pytest.mark.parametrize("place_id", ["_pond", "-x"])
def test_place_id_must_start_alphanumeric(client: TestClient, place_id: str) -> None:
    res = client.post("/api/runs", json={"question": "x", "place_id": place_id})
    assert res.status_code == 422


def test_invalid_ids(client: TestClient) -> None:
    assert client.get("/api/runs/R_UPPER").status_code == 400
    assert client.get("/api/runs/r_missing").status_code == 404
    assert client.get("/api/runs/_r1").status_code == 400


def _make_waiting(run_id: str, place_ids: list[str]) -> None:
    rec = run_store.get_run(run_id)
    assert rec is not None
    rec.status, rec.place_ids = "waiting_user", place_ids
    rec.events.append(
        ClarificationNeeded(questions=[ClarificationQuestion(key="use", label="Used for?")])
    )
    run_store.save_run(rec)


def test_reply_streams_rest_of_run(client: TestClient) -> None:
    run_id = _start(client)[0][1]["run_id"]
    res = client.post(f"/api/runs/{run_id}/reply", json={"answers": {"use": "fish farming"}})
    assert res.status_code == 409

    _make_waiting(run_id, ["p_hoo"])
    before = run_store.get_run(run_id)
    assert before is not None
    res = client.post(
        f"/api/runs/{run_id}/reply",
        json={"answers": {"use": "fish farming", "junk": "x"}, "remember": True},
    )
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/event-stream")
    evs = _events(res.text)
    names = [n for n, _ in evs]
    assert names[0] == "clarification_answered" and names[-1] == "done"
    assert "answer" in names and names.count("done") == 1
    assert evs[0][1] == {
        "event": "clarification_answered",
        "answers": {"use": "fish farming"},
        "remember": True,
    }
    assert evs[-1][1]["run_id"] == run_id and evs[-1][1]["status"] == "done"

    stored = run_store.get_run(run_id)
    assert stored is not None and stored.status == "done"
    assert stored.params["answers"] == {"use": "fish farming"}
    log = [e.event for e in stored.events]
    assert log.index("clarification_needed") < log.index("clarification_answered")
    assert log[log.index("clarification_answered") :] == names
    # continued steps don't overwrite the first leg's steps
    assert len(stored.steps) == names.count("step_finished") + len(before.steps)
    from app.services import memory

    assert memory.prefill("demo", "p_hoo", ["use"])["use"].value == "fish farming"
    # a second submit is refused: the run is no longer waiting
    again = client.post(f"/api/runs/{run_id}/reply", json={"answers": {"use": "x"}})
    assert again.status_code == 409


def test_reply_memory_error_leaves_run_waiting(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression: if memory refuses, reply is a 400 and the run can still be answered."""
    from app.services import memory

    run_id = _start(client)[0][1]["run_id"]
    _make_waiting(run_id, ["p_hoo"])

    def refuse(*args, **kwargs):
        raise ValueError("invalid place_id")

    monkeypatch.setattr(memory, "write_profile", refuse)
    res = client.post(f"/api/runs/{run_id}/reply", json={"answers": {"use": "fish"}})
    assert res.status_code == 400
    stored = run_store.get_run(run_id)
    assert stored is not None and stored.status == "waiting_user"
    assert "answers" not in stored.params
    assert all(e.event != "clarification_answered" for e in stored.events)


def test_apply_reply_is_atomic(client: TestClient) -> None:
    """Regression: concurrent replies can't both pass the waiting_user check."""
    run_id = _start(client)[0][1]["run_id"]
    _make_waiting(run_id, [])
    results: list[str] = []

    def work(value: str) -> None:
        try:
            run_store.apply_reply(run_id, "demo", {"use": value}, False)
            results.append("ok")
        except run_store.RunStateError:
            results.append("409")

    threads = [threading.Thread(target=work, args=(f"v{i}",)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == ["409"] * 7 + ["ok"]
    stored = run_store.get_run(run_id)
    assert stored is not None
    assert [e.event for e in stored.events].count("clarification_answered") == 1
    with pytest.raises(KeyError):
        run_store.apply_reply(run_id, "mallory", {"use": "x"}, False)


def test_reply_too_long_answer_is_400(client: TestClient) -> None:
    run_id = _start(client)[0][1]["run_id"]
    _make_waiting(run_id, [])
    res = client.post(f"/api/runs/{run_id}/reply", json={"answers": {"use": "x" * 1000}})
    assert res.status_code == 400
    assert run_store.get_run(run_id).status == "waiting_user"  # type: ignore[union-attr]


def _ring(n: int) -> dict:
    pts = [
        [114.0 + 0.01 * math.cos(2 * math.pi * i / n), 22.5 + 0.01 * math.sin(2 * math.pi * i / n)]
        for i in range(n)
    ]
    return {"type": "Polygon", "coordinates": [[*pts, pts[0]]]}


def test_outline_size_caps(client: TestClient) -> None:
    """Regression: huge outlines are refused before anything is stored or streamed."""
    big = client.post("/api/runs", json={"question": "x", "area": {"geojson": _ring(10_001)}})
    assert big.status_code == 422
    feat = {"type": "Feature", "properties": {}, "geometry": _ring(4)}
    many = {"type": "FeatureCollection", "features": [feat] * 201}
    res = client.post("/api/runs", json={"question": "x", "area": {"geojson": many}})
    assert res.status_code == 422
    with pytest.raises(ValueError):
        AreaResolveRequest(geojson=_ring(20_000))
    ok = _start(client, area={"geojson": _ring(2_000)})
    assert ok[-1][0] == "done"


def test_orphaned_earth_call_keeps_its_run(client: TestClient) -> None:
    """Regression: cancelling a step (client gone) must not reset earth's run/listener
    while the worker thread is still inside earth."""
    seen: dict[str, object] = {}
    release = threading.Event()

    def slow() -> None:
        release.wait(5)
        seen["run"] = earth_calls.current_run()
        seen["listener"] = earth_calls._listener is not None

    async def main() -> None:
        st = preset_run._Steps("r_orphan01")

        async def consume() -> None:
            async for _ in st.run("Slow", "d", slow):
                pass

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert preset_run._EARTH_LOCK.locked()  # still held by the orphaned thread
        release.set()
        for _ in range(200):
            if not preset_run._EARTH_LOCK.locked():
                break
            await asyncio.sleep(0.01)

    asyncio.run(main())
    assert seen == {"run": "r_orphan01", "listener": True}
    assert not preset_run._EARTH_LOCK.locked()
    assert earth_calls._run_id is None and earth_calls._listener is None


def test_leaving_after_answer_keeps_run_done(client: TestClient) -> None:
    """Regression: a client that closes the stream on `answer` leaves a done run."""

    async def main() -> str:
        gen = preset_run.stream_preset_run(RunRequest(question="filled?"), "demo")
        run_id = ""
        async for ev in gen:
            if ev.event == "run_started":
                run_id = ev.run_id
            if ev.event == "answer":
                break
        await gen.aclose()
        return run_id

    run_id = asyncio.run(main())
    rec = run_store.get_run(run_id)
    assert rec is not None and rec.status == "done"
    assert rec.provenance and rec.answer is not None
    assert [e.event for e in rec.events][-2:] == ["answer", "done"]


def test_store_failure_still_ends_with_done(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression: if the store fails mid-stream, the client still gets error + done."""
    real = run_store.append_event

    def flaky(run_id, event):
        if getattr(event, "event", None) == "block_ready":
            raise sqlite3.OperationalError("database is locked")
        return real(run_id, event)

    monkeypatch.setattr(run_store, "append_event", flaky)
    evs = _start(client)
    names = [n for n, _ in evs]
    assert names[-2:] == ["error", "done"] and dict(evs)["done"]["status"] == "failed"
    rec = run_store.get_run(evs[0][1]["run_id"])
    assert rec is not None and rec.status == "failed"


@pytest.mark.parametrize(
    "url",
    [
        "/api/layers/../water/x.png",
        "/api/layers/%2e%2e/water/x.png",
        "/api/layers/r_1/%2e%2e/x.png",
        "/api/layers/r_1/water/%2e%2e.png",
        "/api/layers/r_1/water/..%2f..%2fruns.png",
        "/api/layers/r_1/water/%2fetc%2fpasswd.png",
        "/api/layers//etc/passwd/x.png",
        "/api/layers/r_1/water/missing.png",
    ],
)
def test_layers_reject_traversal(client: TestClient, url: str) -> None:
    assert client.get(url).status_code in (400, 404)


def test_earth_error_yields_error_and_failed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*args, **kwargs):
        raise earth.NoClearScenes("0 of 9 optical scenes clear.", 'Try kind="radar".')

    monkeypatch.setattr(earth, "series", boom)
    evs = _start(client)
    names = [n for n, _ in evs]
    assert "answer" not in names
    assert names[-2:] == ["error", "done"]
    data = dict(evs)
    assert data["error"]["kind"] == "no_clear_scenes" and data["error"]["recoverable"] is True
    assert data["done"]["status"] == "failed"
    failed_step = [d for n, d in evs if n == "step_finished"][-1]
    assert failed_step["error"] == "no_clear_scenes"
    assert client.get(f"/api/runs/{data['run_started']['run_id']}").json()["status"] == "failed"


def test_invalid_area_is_400(client: TestClient) -> None:
    bad = {"geojson": {"type": "Point", "coordinates": [114.0, 22.5]}}
    res = client.post("/api/runs", json={"question": "x", "area": bad})
    assert res.status_code == 400


def test_openapi_has_stream_and_answer(client: TestClient) -> None:
    app = FastAPI()
    app.include_router(runs.router, prefix="/api")
    spec = app.openapi()
    schemas = spec["components"]["schemas"]
    for name in ("Answer", "RunRecord", "RunStarted", "AnswerEvent", "Done", "ClarificationNeeded"):
        assert name in schemas
    sse = spec["paths"]["/api/runs"]["post"]["responses"]["200"]["content"]["text/event-stream"]
    refs = [r["$ref"].rsplit("/", 1)[-1] for r in sse["schema"]["oneOf"]]
    assert all(r in schemas for r in refs) and len(refs) == 11
    reply = spec["paths"]["/api/runs/{run_id}/reply"]["post"]["responses"]["200"]["content"]
    assert "text/event-stream" in reply
    assert "/api/threads/{thread_id}" not in spec["paths"]
    answer = schemas["Answer"]["properties"]
    for field in ("title", "kind", "eyebrow", "color", "l1", "l2", "skill_id", "suggested_skills"):
        assert field in answer
