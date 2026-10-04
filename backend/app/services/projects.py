"""Chat projects: per-user folders of conversations, in the run store's SQLite DB.

Two tables: `projects` (one row per folder) and `thread_projects` (which thread sits in which
folder, per user). Threads themselves are runs sharing a `thread_id`; they are never changed
here, so deleting a project just drops its assignments and the chats become unfiled.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime

from app.schemas.projects import Project, new_project_id
from app.services.runs import _connect, db_path

__all__ = [
    "MAX_PROJECTS_PER_USER",
    "LimitReached",
    "ProjectNotFound",
    "assign_thread",
    "create_project",
    "delete_project",
    "deleted_thread_ids",
    "forget_thread",
    "list_projects",
    "project_ids_by_thread",
    "rename_project",
]

MAX_PROJECTS_PER_USER = 50

_SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id, created_at);
CREATE TABLE IF NOT EXISTS thread_projects (
    user_id    TEXT NOT NULL,
    thread_id  TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (user_id, thread_id)
);
CREATE INDEX IF NOT EXISTS thread_projects_project ON thread_projects(project_id);
CREATE TABLE IF NOT EXISTS deleted_threads (
    user_id    TEXT NOT NULL,
    thread_id  TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    PRIMARY KEY (user_id, thread_id)
);
"""
_COLS = "id, name, created_at, updated_at"
_WRITE_LOCK = threading.Lock()
_INIT_LOCK = threading.Lock()
_initialised: set[str] = set()


class ProjectNotFound(KeyError):
    """No such project for this user."""


class LimitReached(ValueError):
    """Too many projects for the user."""


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


def _row(r: tuple[str, str, str, str]) -> Project:
    return Project(
        id=r[0],
        name=r[1],
        created_at=datetime.fromisoformat(r[2]),
        updated_at=datetime.fromisoformat(r[3]),
    )


def _exists(conn: sqlite3.Connection, user_id: str, project_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM projects WHERE id = ? AND user_id = ?", (project_id, user_id)
    ).fetchone()
    return row is not None


def list_projects(user_id: str) -> list[Project]:
    """The user's projects in creation order (oldest first)."""
    with _db() as conn:
        rows = conn.execute(
            f"SELECT {_COLS} FROM projects WHERE user_id = ? ORDER BY created_at, rowid",
            (user_id,),
        ).fetchall()
    return [_row(r) for r in rows]


def create_project(user_id: str, name: str) -> Project:
    now = datetime.now(UTC)
    project = Project(id=new_project_id(), name=name, created_at=now, updated_at=now)
    with _WRITE_LOCK, _db() as conn:
        (count,) = conn.execute(
            "SELECT COUNT(*) FROM projects WHERE user_id = ?", (user_id,)
        ).fetchone()
        if count >= MAX_PROJECTS_PER_USER:
            raise LimitReached(f"At most {MAX_PROJECTS_PER_USER} projects per user.")
        conn.execute(
            "INSERT INTO projects (id, user_id, name, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (project.id, user_id, name, now.isoformat(), now.isoformat()),
        )
    return project


def rename_project(user_id: str, project_id: str, name: str) -> Project:
    now = datetime.now(UTC)
    with _WRITE_LOCK, _db() as conn:
        cur = conn.execute(
            "UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (name, now.isoformat(), project_id, user_id),
        )
        if cur.rowcount == 0:
            raise ProjectNotFound(project_id)
        row = conn.execute(
            f"SELECT {_COLS} FROM projects WHERE id = ? AND user_id = ?", (project_id, user_id)
        ).fetchone()
    return _row(row)


def delete_project(user_id: str, project_id: str) -> None:
    """Delete the project; its chats stay and become unfiled."""
    with _WRITE_LOCK, _db() as conn:
        if not _exists(conn, user_id, project_id):
            raise ProjectNotFound(project_id)
        conn.execute(
            "DELETE FROM thread_projects WHERE user_id = ? AND project_id = ?",
            (user_id, project_id),
        )
        conn.execute("DELETE FROM projects WHERE id = ? AND user_id = ?", (project_id, user_id))


def project_ids_by_thread(user_id: str) -> dict[str, str]:
    """thread_id -> project_id for every chat the user has filed."""
    with _db() as conn:
        rows = conn.execute(
            "SELECT thread_id, project_id FROM thread_projects WHERE user_id = ?", (user_id,)
        ).fetchall()
    return {t: p for t, p in rows}


def assign_thread(user_id: str, thread_id: str, project_id: str | None) -> None:
    """File the thread in a project, or unfile it with `None`. The caller has checked that
    the thread is the user's. Raises `ProjectNotFound` for an unknown project."""
    with _WRITE_LOCK, _db() as conn:
        if project_id is None:
            conn.execute(
                "DELETE FROM thread_projects WHERE user_id = ? AND thread_id = ?",
                (user_id, thread_id),
            )
            return
        if not _exists(conn, user_id, project_id):
            raise ProjectNotFound(project_id)
        conn.execute(
            "INSERT INTO thread_projects (user_id, thread_id, project_id) VALUES (?, ?, ?)"
            " ON CONFLICT(user_id, thread_id) DO UPDATE SET project_id = excluded.project_id",
            (user_id, thread_id, project_id),
        )


def forget_thread(user_id: str, thread_id: str) -> None:
    """Delete a chat for the user: it leaves their list and its project for good. The runs
    themselves are kept, so the daily spend limit still counts them and share links already
    sent keep working. The caller has checked that the thread is the user's."""
    now = datetime.now(UTC).isoformat()
    with _WRITE_LOCK, _db() as conn:
        conn.execute(
            "DELETE FROM thread_projects WHERE user_id = ? AND thread_id = ?", (user_id, thread_id)
        )
        conn.execute(
            "INSERT OR IGNORE INTO deleted_threads (user_id, thread_id, deleted_at)"
            " VALUES (?, ?, ?)",
            (user_id, thread_id, now),
        )


def deleted_thread_ids(user_id: str) -> set[str]:
    """The chats the user has deleted."""
    with _db() as conn:
        rows = conn.execute(
            "SELECT thread_id FROM deleted_threads WHERE user_id = ?", (user_id,)
        ).fetchall()
    return {r[0] for r in rows}
