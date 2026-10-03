"""Run store (BUILD-PLAN I4): one SQLite table of `RunRecord`s, keyed by run id.

The database lives at `earth.settings.data_dir()/runs.sqlite` (git-ignored), or at
`$RUNS_DB_PATH` when set (tests). Each call opens its own connection; writes that read
before they write (`append_event`, `update_status`) also hold a process lock and an
IMMEDIATE transaction, so concurrent threads never lose an update.
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, get_args

from pydantic import TypeAdapter

import earth
from app.schemas.runs import ID_PATTERN, RunRecord, RunStatus, Step
from app.schemas.stream import (
    AnswerEvent,
    BlockReady,
    ClarificationAnswered,
    ClarificationNeeded,
    Done,
    StepFinished,
    StreamEvent,
)
from earth import settings

__all__ = [
    "RunStateError",
    "RunStoreError",
    "append_event",
    "apply_reply",
    "db_path",
    "get_run",
    "list_runs",
    "list_threads",
    "save_run",
    "set_provenance",
    "update_status",
]

_ID_RE = re.compile(ID_PATTERN)
_STATUSES: frozenset[str] = frozenset(get_args(RunStatus))
_EVENT = TypeAdapter(StreamEvent)
_WRITE_LOCK = threading.Lock()
_INIT_LOCK = threading.Lock()
_initialised: set[str] = set()
_TS_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    run_id      TEXT PRIMARY KEY,
    thread_id   TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    status      TEXT NOT NULL,
    record_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_thread ON runs(thread_id, created_at);
CREATE INDEX IF NOT EXISTS runs_user ON runs(user_id, created_at);
"""


class RunStoreError(ValueError):
    """An id or status was rejected before touching the database."""


class RunStateError(Exception):
    """The run is not in the state the change needs (e.g. reply to a run not waiting)."""

    def __init__(self, status: str) -> None:
        super().__init__(f"Run is {status}, not waiting_user.")
        self.status = status


def db_path() -> Path:
    """Where the run store lives: `$RUNS_DB_PATH`, else `data_dir()/runs.sqlite`."""
    env = os.environ.get("RUNS_DB_PATH")
    return Path(env) if env else settings.data_dir() / "runs.sqlite"


def _check_id(value: object, what: str) -> str:
    if not isinstance(value, str) or not _ID_RE.fullmatch(value):
        raise RunStoreError(f"invalid {what}: must match {ID_PATTERN}")
    return value


def _check_status(status: object) -> str:
    if status not in _STATUSES:
        raise RunStoreError(f"invalid status: {status!r}")
    return str(status)


def _ts(dt: datetime) -> str:
    """Sortable UTC timestamp text (naive datetimes are taken as UTC)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).strftime(_TS_FORMAT)


def _parse_ts(text: str) -> datetime:
    return datetime.strptime(text, _TS_FORMAT).replace(tzinfo=UTC)


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=30, check_same_thread=False, isolation_level=None)
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


@contextmanager
def _db() -> Iterator[sqlite3.Connection]:
    path = db_path().absolute()
    if str(path) not in _initialised or not path.exists():
        with _INIT_LOCK:
            path.parent.mkdir(parents=True, exist_ok=True)
            conn = _connect(path)
            try:
                conn.execute("PRAGMA journal_mode = WAL")
                conn.executescript(_SCHEMA)
            finally:
                conn.close()
            _initialised.add(str(path))
    conn = _connect(path)
    try:
        yield conn
    finally:
        conn.close()


def _check_record(run: RunRecord) -> None:
    _check_id(run.run_id, "run_id")
    _check_id(run.thread_id, "thread_id")
    _check_id(run.user_id, "user_id")
    _check_status(run.status)


def _write(conn: sqlite3.Connection, run: RunRecord) -> None:
    conn.execute(
        """
        INSERT INTO runs (run_id, thread_id, user_id, created_at, status, record_json)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
            thread_id = excluded.thread_id,
            user_id = excluded.user_id,
            created_at = excluded.created_at,
            status = excluded.status,
            record_json = excluded.record_json
        """,
        (
            run.run_id,
            run.thread_id,
            run.user_id,
            _ts(run.created_at),
            run.status,
            run.model_dump_json(by_alias=True),
        ),
    )


def _load(row: tuple[Any, ...] | None) -> RunRecord | None:
    return None if row is None else RunRecord.model_validate_json(row[0])


def save_run(run: RunRecord) -> None:
    """Insert or replace a run record."""
    _check_record(run)
    with _WRITE_LOCK, _db() as conn:
        _write(conn, run)


def get_run(run_id: str) -> RunRecord | None:
    """The stored run, or None if unknown."""
    _check_id(run_id, "run_id")
    with _db() as conn:
        row = conn.execute("SELECT record_json FROM runs WHERE run_id = ?", (run_id,)).fetchone()
    return _load(row)


def list_runs(thread_id: str) -> list[RunRecord]:
    """All runs in a thread, oldest first."""
    _check_id(thread_id, "thread_id")
    with _db() as conn:
        rows = conn.execute(
            "SELECT record_json FROM runs WHERE thread_id = ? ORDER BY created_at ASC, rowid ASC",
            (thread_id,),
        ).fetchall()
    return [RunRecord.model_validate_json(r[0]) for r in rows]


def list_threads(user_id: str) -> list[tuple[str, datetime]]:
    """A user's threads as (thread_id, last run created_at), most recent first."""
    _check_id(user_id, "user_id")
    with _db() as conn:
        rows = conn.execute(
            """
            SELECT thread_id, MAX(created_at) AS last FROM runs
            WHERE user_id = ? GROUP BY thread_id ORDER BY last DESC, thread_id ASC
            """,
            (user_id,),
        ).fetchall()
    return [(t, _parse_ts(last)) for t, last in rows]


@contextmanager
def _mutate(run_id: str) -> Iterator[RunRecord]:
    """Read-modify-write one run atomically; raises KeyError if the run is unknown."""
    _check_id(run_id, "run_id")
    with _WRITE_LOCK, _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            row = conn.execute(
                "SELECT record_json FROM runs WHERE run_id = ?", (run_id,)
            ).fetchone()
            run = _load(row)
            if run is None:
                raise KeyError(run_id)
            yield run
            _check_record(run)
            _write(conn, run)
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")


def update_status(run_id: str, status: RunStatus) -> None:
    """Set a run's status. Raises KeyError if the run is unknown."""
    _check_status(status)
    with _mutate(run_id) as run:
        run.status = status


def _sync(run: RunRecord, ev: Any) -> None:
    """Keep the derived fields of the record in step with one event."""
    if isinstance(ev, StepFinished):
        step = Step.model_validate(ev.model_dump(exclude={"event"}))
        run.steps = sorted(
            [s for s in run.steps if s.index != step.index] + [step], key=lambda s: s.index
        )
    elif isinstance(ev, BlockReady):
        for i, b in enumerate(run.blocks):
            if b.id == ev.block.id:
                run.blocks[i] = ev.block
                break
        else:
            run.blocks.append(ev.block)
    elif isinstance(ev, AnswerEvent):
        run.answer = ev.answer
    elif isinstance(ev, Done):
        run.status = ev.status


def append_event(run_id: str, event: StreamEvent | dict[str, Any]) -> RunRecord:
    """Append an event to the run's log and sync steps/blocks/answer/status.

    Returns the updated record. Raises KeyError if the run is unknown and
    pydantic.ValidationError if `event` is not a valid stream event.
    """
    ev = _EVENT.validate_python(event)
    with _mutate(run_id) as run:
        run.events.append(ev)
        _sync(run, ev)
    return run


def set_provenance(run_id: str, provenance: list[earth.Provenance]) -> None:
    """Replace a run's provenance list. Raises KeyError if the run is unknown."""
    with _mutate(run_id) as run:
        run.provenance = list(provenance)


def asked_keys(run: RunRecord) -> set[str]:
    """Question keys of the run's clarification cards."""
    return {q.key for ev in run.events if isinstance(ev, ClarificationNeeded) for q in ev.questions}


def apply_reply(
    run_id: str, user_id: str, answers: dict[str, str], remember: bool
) -> tuple[RunRecord, ClarificationAnswered]:
    """Atomically accept a reply: check the run is the user's and `waiting_user`, keep the
    answers to asked questions, merge them into `params["answers"]`, log a
    `clarification_answered` event and set the status to `running`.

    Raises KeyError if the run is unknown or not the user's, RunStateError if it is not
    waiting for the user (e.g. a second submit already resumed it).
    """
    with _mutate(run_id) as run:
        if run.user_id != user_id:
            raise KeyError(run_id)
        if run.status != "waiting_user":
            raise RunStateError(run.status)
        asked = asked_keys(run)
        accepted = {k: v for k, v in answers.items() if not asked or k in asked}
        run.params["answers"] = {**run.params.get("answers", {}), **accepted}
        ev = ClarificationAnswered(answers=accepted, remember=remember)
        run.events.append(ev)
        run.status = "running"
    return run, ev
