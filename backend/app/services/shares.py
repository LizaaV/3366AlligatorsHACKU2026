"""Share links (BUILD-PLAN M6): snapshots of runs in a `shares` table of the run store's DB.

A share stores a `SharedRun` as JSON, built from the run at share time, so later changes to
the run never reach the link. Revoking sets `revoked_at`; the row stays so the link answers
410 (gone) rather than 404.
"""

from __future__ import annotations

import secrets
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.schemas.runs import RunRecord
from app.schemas.shares import ShareCreated, SharedRun, ShareInfo
from app.services.runs import _connect, db_path

__all__ = [
    "ShareGone",
    "create_share",
    "get_share_run_id",
    "get_shared_run",
    "list_shares",
    "revoke_share",
    "snapshot",
]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS shares (
    slug          TEXT PRIMARY KEY,
    run_id        TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    shared_at     TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    revoked_at    TEXT,
    snapshot_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS shares_run ON shares(run_id, shared_at);
"""
_TS = "%Y-%m-%dT%H:%M:%S.%fZ"
_INIT_LOCK = threading.Lock()
_initialised: set[str] = set()


class ShareGone(Exception):
    """The link existed but is expired or revoked."""


def _now() -> datetime:
    return datetime.now(UTC)


def _ts(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime(_TS)


def _parse(text: str) -> datetime:
    return datetime.strptime(text, _TS).replace(tzinfo=UTC)


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


def _url(slug: str) -> str:
    return f"{settings.public_base_url.rstrip('/')}/proof/{slug}"


def snapshot(run: RunRecord, slug: str, shared_at: datetime, expires_at: datetime) -> SharedRun:
    """Copy the public parts of a run (explicit allow-list; see `SharedRun`).

    Layer URLs (`/api/layers/<run_id>/...`) are rewritten to the share-scoped route
    (`/api/shares/<slug>/layers/...`) so the public JSON never reveals the run id, which would
    give anyone access to `GET /api/runs/<run_id>`. As a last guard, any other occurrence of the
    run id or thread id anywhere in the snapshot is blanked.
    """
    shared = SharedRun(
        question=run.question,
        lang=run.lang,
        area=run.area,
        created_at=run.created_at,
        answer=run.answer,
        blocks=run.blocks,
        steps=run.steps,
        provenance=run.provenance,
        method=run.method,
        shared_at=shared_at,
        expires_at=expires_at,
    )
    text = shared.model_dump_json().replace(
        f"/api/layers/{run.run_id}/", f"/api/shares/{slug}/layers/"
    )
    for private in (run.run_id, run.thread_id):
        if private:
            text = text.replace(private, "redacted")
    return SharedRun.model_validate_json(text)


def create_share(run: RunRecord) -> ShareCreated:
    """Snapshot `run` behind a new unguessable slug that expires after SHARE_TTL_DAYS."""
    now = _now()
    expires = now + timedelta(days=settings.share_ttl_days)
    slug = secrets.token_urlsafe(16)
    shared = snapshot(run, slug, now, expires)
    with _db() as conn:
        conn.execute(
            "INSERT INTO shares (slug, run_id, user_id, shared_at, expires_at, snapshot_json)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (slug, run.run_id, run.user_id, _ts(now), _ts(expires), shared.model_dump_json()),
        )
    return ShareCreated(slug=slug, url=_url(slug), expires_at=expires)


def get_shared_run(slug: str) -> SharedRun | None:
    """The snapshot, None if the slug is unknown; raises `ShareGone` if expired or revoked."""
    with _db() as conn:
        row = conn.execute(
            "SELECT snapshot_json, expires_at, revoked_at FROM shares WHERE slug = ?", (slug,)
        ).fetchone()
    if row is None:
        return None
    if row[2] is not None or _parse(row[1]) <= _now():
        raise ShareGone(slug)
    return SharedRun.model_validate_json(row[0])


def get_share_run_id(slug: str) -> str | None:
    """The run behind a live link (server-side only). None if unknown; `ShareGone` if dead."""
    with _db() as conn:
        row = conn.execute(
            "SELECT run_id, expires_at, revoked_at FROM shares WHERE slug = ?", (slug,)
        ).fetchone()
    if row is None:
        return None
    if row[2] is not None or _parse(row[1]) <= _now():
        raise ShareGone(slug)
    return str(row[0])


def list_shares(run_id: str, user_id: str) -> list[ShareInfo]:
    """The user's share links for a run, newest first."""
    with _db() as conn:
        rows = conn.execute(
            "SELECT slug, shared_at, expires_at, revoked_at FROM shares"
            " WHERE run_id = ? AND user_id = ? ORDER BY shared_at DESC, rowid DESC",
            (run_id, user_id),
        ).fetchall()
    return [
        ShareInfo(
            slug=s,
            url=_url(s),
            shared_at=_parse(a),
            expires_at=_parse(e),
            revoked=r is not None,
        )
        for s, a, e, r in rows
    ]


def revoke_share(slug: str, user_id: str) -> bool:
    """Revoke a link the user owns (idempotent). False if unknown or not theirs."""
    with _db() as conn:
        row = conn.execute("SELECT user_id FROM shares WHERE slug = ?", (slug,)).fetchone()
        if row is None or row[0] != user_id:
            return False
        conn.execute(
            "UPDATE shares SET revoked_at = ? WHERE slug = ? AND revoked_at IS NULL",
            (_ts(_now()), slug),
        )
    return True
