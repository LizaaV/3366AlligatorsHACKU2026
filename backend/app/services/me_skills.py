"""Installed skills: which skills a user installed, in the run store's SQLite DB."""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from app.services.runs import _connect, db_path

__all__ = ["install", "list_installed", "uninstall"]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS installed_skills (
    user_id      TEXT NOT NULL,
    skill_id     TEXT NOT NULL,
    installed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, skill_id)
);
"""
_WRITE_LOCK = threading.Lock()
_INIT_LOCK = threading.Lock()
_initialised: set[str] = set()


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


def list_installed(user_id: str) -> list[str]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT skill_id FROM installed_skills WHERE user_id = ? ORDER BY installed_at, rowid",
            (user_id,),
        ).fetchall()
    return [r[0] for r in rows]


def install(user_id: str, skill_id: str) -> list[str]:
    """Idempotent."""
    with _WRITE_LOCK, _db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO installed_skills (user_id, skill_id, installed_at)"
            " VALUES (?, ?, ?)",
            (user_id, skill_id, datetime.now(UTC).isoformat()),
        )
    return list_installed(user_id)


def uninstall(user_id: str, skill_id: str) -> list[str]:
    """Idempotent."""
    with _WRITE_LOCK, _db() as conn:
        conn.execute(
            "DELETE FROM installed_skills WHERE user_id = ? AND skill_id = ?", (user_id, skill_id)
        )
    return list_installed(user_id)
