"""Contract test for the run store (BUILD-PLAN I4). Runs on a tmp SQLite file, no network."""

from __future__ import annotations

import sqlite3
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

import earth
from app.schemas.answer import Answer, Confidence, StatItem
from app.schemas.runs import RunRecord, Step, new_run_id, new_thread_id
from app.schemas.stream import (
    AnswerEvent,
    BlockReady,
    ClarificationNeeded,
    ClarificationQuestion,
    Done,
    RunStarted,
    StepFinished,
    ValueSource,
)
from app.services import runs as store
from earth.presets import HOO_HOK_WAI

T0 = datetime(2026, 10, 3, 9, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch) -> Path:
    monkeypatch.setenv("EARTH_IMPL", "stub")
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path / "data"))
    path = tmp_path / "db" / "runs.sqlite"
    monkeypatch.setenv("RUNS_DB_PATH", str(path))
    return path


def _answer(blocks=()) -> Answer:
    return Answer(
        title="The ponds were filled in",
        sentence="The ponds were filled in since 2024.",
        cause="Land filling",
        stats=[StatItem(l="Dry area", v="4.6 ha", ci="90% range 3.9–5.3")],
        confidence=Confidence(level="Medium", pct=70, note="Two clear scenes."),
        blocks=list(blocks),
        hash="h_abc",
    )


def _blocks():
    s = earth.series(HOO_HOK_WAI, "greenness", years=2)
    return [
        earth.show.timeline(s, title="Greenness inside the ponds", primary=True, id="b_tl"),
        earth.show.stat("Dry area", 4.6, "ha", lo=3.9, hi=5.3, id="b_st"),
    ]


def _run(run_id=None, thread_id="t_main", user_id="demo", created_at=T0, **kw) -> RunRecord:
    return RunRecord(
        run_id=run_id or new_run_id(),
        thread_id=thread_id,
        user_id=user_id,
        question="Were the ponds filled?",
        status="running",
        created_at=created_at,
        **kw,
    )


def test_db_created_at_env_path(db):
    store.save_run(_run("r_one"))
    assert store.db_path() == db and db.exists()
    con = sqlite3.connect(db)
    assert con.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    cols = [r[1] for r in con.execute("PRAGMA table_info(runs)")]
    assert cols == ["run_id", "thread_id", "user_id", "created_at", "status", "record_json"]
    con.close()


def test_default_path_under_data_dir(tmp_path, monkeypatch):
    monkeypatch.delenv("RUNS_DB_PATH")
    assert store.db_path() == tmp_path / "data" / "runs.sqlite"


def test_full_record_round_trip():
    blocks = _blocks()
    run = _run(
        "r_full",
        place_ids=["pl_hhw"],
        answer=_answer(blocks),
        blocks=blocks,
        steps=[Step(index=0, title="Look", desc="Find scenes", tool="earth.scenes")],
        provenance=[blocks[0].provenance[0]],
        script="s = earth.series(area, 'greenness')",
        params={"years": 2},
        events=[
            RunStarted(run_id="r_full", thread_id="t_main"),
            ClarificationNeeded(
                questions=[
                    ClarificationQuestion(
                        key="use",
                        label="What is it used for?",
                        value="fish ponds",
                        source=ValueSource(from_="memory", saved=T0.date()),
                    )
                ]
            ),
            BlockReady(block=blocks[0]),
        ],
    )
    store.save_run(run)
    got = store.get_run("r_full")
    assert got == run
    assert got.blocks[0].type == "timeline" and got.answer.blocks[1].type == "stat"
    assert got.events[1].questions[0].source.from_ == "memory"
    assert store.get_run("r_missing") is None


def test_save_is_upsert():
    run = _run("r_up")
    store.save_run(run)
    store.save_run(run.model_copy(update={"status": "done", "question": "Changed?"}))
    got = store.get_run("r_up")
    assert got.status == "done" and got.question == "Changed?"
    assert len(store.list_runs("t_main")) == 1


def test_list_runs_oldest_first_and_threads_latest_first():
    store.save_run(_run("r_b", created_at=T0 + timedelta(minutes=5)))
    store.save_run(_run("r_a", created_at=T0))
    store.save_run(_run("r_c", created_at=T0 + timedelta(minutes=9)))
    store.save_run(_run("r_x", thread_id="t_other", created_at=T0 + timedelta(hours=1)))
    store.save_run(_run("r_y", thread_id="t_old", created_at=T0 - timedelta(days=1)))
    store.save_run(_run("r_z", thread_id="t_else", user_id="someone"))

    assert [r.run_id for r in store.list_runs("t_main")] == ["r_a", "r_b", "r_c"]
    assert store.list_runs("t_none") == []
    assert store.list_threads("demo") == [
        ("t_other", T0 + timedelta(hours=1)),
        ("t_main", T0 + timedelta(minutes=9)),
        ("t_old", T0 - timedelta(days=1)),
    ]
    assert store.list_threads("nobody") == []


def test_update_status():
    store.save_run(_run("r_s"))
    store.update_status("r_s", "waiting_user")
    assert store.get_run("r_s").status == "waiting_user"
    with pytest.raises(store.RunStoreError):
        store.update_status("r_s", "bogus")  # type: ignore[arg-type]
    with pytest.raises(KeyError):
        store.update_status("r_missing", "done")


def test_append_event_syncs_record():
    store.save_run(_run("r_ev"))
    tl, st = _blocks()
    store.append_event("r_ev", RunStarted(run_id="r_ev", thread_id="t_main"))
    store.append_event(
        "r_ev", StepFinished(index=1, title="Measure", desc="d", tool="earth.series", ms=12)
    )
    store.append_event("r_ev", StepFinished(index=0, title="Look", desc="d", tool="earth.scenes"))
    store.append_event(
        "r_ev",
        StepFinished(index=1, title="Measure", desc="d", tool="earth.series", error="timeout"),
    )
    store.append_event("r_ev", BlockReady(block=tl))
    store.append_event("r_ev", {"event": "block_ready", "block": st.model_dump(mode="json")})
    store.append_event("r_ev", BlockReady(block=tl.model_copy(update={"title": "Updated"})))
    store.append_event("r_ev", AnswerEvent(answer=_answer([tl])))
    run = store.append_event("r_ev", Done(run_id="r_ev", status="done", ms=900))

    assert run == store.get_run("r_ev")
    assert [e.event for e in run.events] == [
        "run_started",
        "step_finished",
        "step_finished",
        "step_finished",
        "block_ready",
        "block_ready",
        "block_ready",
        "answer",
        "done",
    ]
    assert [s.index for s in run.steps] == [0, 1]
    assert run.steps[1].error == "timeout" and run.steps[1].ms is None
    assert [b.id for b in run.blocks] == ["b_tl", "b_st"]
    assert run.blocks[0].title == "Updated"
    assert run.answer.sentence.startswith("The ponds")
    assert run.status == "done"


def test_append_event_rejects_bad_input():
    store.save_run(_run("r_bad"))
    with pytest.raises(ValidationError):
        store.append_event("r_bad", {"event": "nope"})
    with pytest.raises(KeyError):
        store.append_event("r_missing", RunStarted(run_id="r_missing", thread_id="t_main"))
    assert store.get_run("r_bad").events == []


@pytest.mark.parametrize(
    "bad", ["", "R_UPPER", "../etc", "a b", "x" * 65, "r_1;DROP TABLE runs", "é"]
)
def test_invalid_ids_rejected(bad, db):
    with pytest.raises(store.RunStoreError):
        store.get_run(bad)
    with pytest.raises(store.RunStoreError):
        store.list_runs(bad)
    with pytest.raises(store.RunStoreError):
        store.list_threads(bad)
    with pytest.raises(store.RunStoreError):
        store.update_status(bad, "done")
    with pytest.raises(store.RunStoreError):
        store.append_event(bad, RunStarted(run_id="r_1", thread_id="t_1"))
    for field in ("run_id", "thread_id", "user_id"):
        with pytest.raises(store.RunStoreError):
            store.save_run(_run("r_ok").model_copy(update={field: bad}))
    assert not db.exists() or store.get_run("r_ok") is None


def test_concurrent_saves_and_appends():
    n_threads, per_thread = 8, 15
    store.save_run(_run("r_shared"))
    errors: list[BaseException] = []

    def work(k: int) -> None:
        try:
            thread = new_thread_id()
            for i in range(per_thread):
                store.save_run(_run(f"r_{k}_{i}", thread_id=thread))
                store.append_event(
                    "r_shared",
                    StepFinished(index=k * per_thread + i, title="s", desc="d", tool="t"),
                )
        except BaseException as e:  # noqa: BLE001
            errors.append(e)

    threads = [threading.Thread(target=work, args=(k,)) for k in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == []
    shared = store.get_run("r_shared")
    assert len(shared.events) == n_threads * per_thread
    assert [s.index for s in shared.steps] == list(range(n_threads * per_thread))
    assert len(store.list_threads("demo")) == n_threads + 1
    for k in range(n_threads):
        assert store.get_run(f"r_{k}_{per_thread - 1}") is not None
