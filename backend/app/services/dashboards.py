"""Dashboards (BUILD-PLAN M8, ARCHITECTURE §4.4): saved blocks in a `dashboards` table of the
run store's SQLite DB (one JSON document per dashboard).

Refresh re-runs the block's saved script in the sandbox with the saved params, moved forward
(see `move_params`). No LLM is involved anywhere in this module: the caption is a template
filled from the new block's numbers.
"""

from __future__ import annotations

import secrets
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from typing import Any

from app.schemas.dashboards import (
    BlockSource,
    Dashboard,
    DashboardBlock,
    DashboardSummary,
    new_block_id,
    new_dashboard_id,
)
from app.schemas.runs import RunRecord
from app.services.runs import _connect, db_path
from app.services.sandbox import RunOutcome, ScriptError, run_script
from earth.blocks import Block

__all__ = [
    "BlockNotFound",
    "DashboardNotFound",
    "NoMatchingBlock",
    "RefreshFailed",
    "add_block",
    "create_dashboard",
    "delete_dashboard",
    "get_dashboard",
    "list_dashboards",
    "move_params",
    "refresh_block",
    "remove_block",
    "rename_dashboard",
    "summarize",
]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS dashboards (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    doc_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dashboards_user ON dashboards(user_id, created_at);
"""
_WRITE_LOCK = threading.Lock()
_INIT_LOCK = threading.Lock()
_initialised: set[str] = set()


class DashboardNotFound(KeyError):
    """No such dashboard for this user."""


class BlockNotFound(KeyError):
    """No such block (on the dashboard, or in the source run)."""


class NoMatchingBlock(Exception):
    """The re-run did not produce a block like the saved one."""


class RefreshFailed(Exception):
    """The saved script failed; the old block is kept."""

    def __init__(self, error: ScriptError) -> None:
        super().__init__(error.message)
        self.error = error


class NoScript(ValueError):
    """The source run has no saved script, so its blocks cannot be refreshed."""


def _now() -> datetime:
    return datetime.now(UTC)


def _today() -> date:
    return datetime.now(UTC).date()


# --- storage ------------------------------------------------------------------------------------


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


def _write(conn: sqlite3.Connection, dash: Dashboard) -> None:
    conn.execute(
        "INSERT INTO dashboards (id, user_id, created_at, doc_json) VALUES (?, ?, ?, ?)"
        " ON CONFLICT(id) DO UPDATE SET doc_json = excluded.doc_json",
        (dash.id, dash.user_id, dash.created_at.isoformat(), dash.model_dump_json()),
    )


def _read(conn: sqlite3.Connection, dash_id: str, user_id: str) -> Dashboard:
    row = conn.execute(
        "SELECT doc_json FROM dashboards WHERE id = ? AND user_id = ?", (dash_id, user_id)
    ).fetchone()
    if row is None:
        raise DashboardNotFound(dash_id)
    return Dashboard.model_validate_json(row[0])


@contextmanager
def _mutate(dash_id: str, user_id: str) -> Iterator[Dashboard]:
    """Read-modify-write one dashboard atomically."""
    with _WRITE_LOCK, _db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        try:
            dash = _read(conn, dash_id, user_id)
            yield dash
            _write(conn, dash)
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")


# --- dashboards ---------------------------------------------------------------------------------


def create_dashboard(user_id: str, name: str) -> Dashboard:
    dash = Dashboard(id=new_dashboard_id(), user_id=user_id, name=name)
    with _WRITE_LOCK, _db() as conn:
        _write(conn, dash)
    return dash


def list_dashboards(user_id: str) -> list[DashboardSummary]:
    """The user's dashboards, newest first."""
    with _db() as conn:
        rows = conn.execute(
            "SELECT doc_json FROM dashboards WHERE user_id = ?"
            " ORDER BY created_at DESC, rowid DESC",
            (user_id,),
        ).fetchall()
    docs = [Dashboard.model_validate_json(r[0]) for r in rows]
    return [
        DashboardSummary(id=d.id, name=d.name, created_at=d.created_at, block_count=len(d.blocks))
        for d in docs
    ]


def get_dashboard(dash_id: str, user_id: str) -> Dashboard:
    """Raises `DashboardNotFound` if unknown or not the user's."""
    with _db() as conn:
        return _read(conn, dash_id, user_id)


def rename_dashboard(dash_id: str, user_id: str, name: str) -> Dashboard:
    with _mutate(dash_id, user_id) as dash:
        dash.name = name
    return dash


def delete_dashboard(dash_id: str, user_id: str) -> None:
    with _WRITE_LOCK, _db() as conn:
        _read(conn, dash_id, user_id)
        conn.execute("DELETE FROM dashboards WHERE id = ?", (dash_id,))


# --- captions -----------------------------------------------------------------------------------


def _fmt_date(d: date | datetime) -> str:
    return f"{d.day} {d:%b %Y}"


def summarize(block: Block) -> str:
    """A short numeric summary of a block, from its own numbers (no free text generation)."""
    kind = block.type
    if kind == "stat":
        return f"{block.label}: {block.value:g} {block.unit}"
    if kind == "timeline":
        if not block.data:
            return "no clear scenes"
        last = block.data[-1]
        return f"latest {last.value:.2f} on {_fmt_date(last.date)}, {len(block.data)} points"
    if kind == "then_now":
        return f"{block.before.label} vs {block.after.label}"
    if kind == "highlight":
        return f"{block.total_ha:g} ha in {len(block.patches)} patches"
    if kind == "scene_strip":
        used = sum(1 for s in block.scenes if s.used)
        return f"{used} of {len(block.scenes)} scenes used"
    if kind == "hypotheses":
        top = block.rows[0] if block.rows else None
        return f"top: {top.label} ({top.verdict})" if top else "no hypotheses"
    return block.cant_tell  # limits


def _caption(prefix: str, when: datetime, block: Block) -> str:
    return f"{prefix} {_fmt_date(when)}: {summarize(block)}"


# --- blocks -------------------------------------------------------------------------------------


def add_block(dash_id: str, user_id: str, run: RunRecord, run_block_id: str) -> DashboardBlock:
    """Copy a block of `run` (with its script and params) onto the dashboard.

    Raises `NoScript` if the run has no script, `BlockNotFound` if the run has no such block.
    """
    index = next((i for i, b in enumerate(run.blocks) if b.id == run_block_id), None)
    if index is None:
        raise BlockNotFound(run_block_id)
    if not run.script:
        raise NoScript(
            "This run has no saved script, so its blocks cannot be refreshed. "
            "Save blocks from a run that ran code."
        )
    now = _now()
    block = run.blocks[index].model_copy(deep=True)
    saved = DashboardBlock(
        block_id=new_block_id(),
        block=block,
        source=BlockSource(
            run_id=run.run_id,
            run_date=run.created_at.astimezone(UTC).date(),
            script=run.script,
            params=dict(run.params),
            block_index=index,
            block_id=run_block_id,
        ),
        refreshed_at=now,
        caption=_caption("Saved", now, block),
    )
    with _mutate(dash_id, user_id) as dash:
        dash.blocks.append(saved)
    return saved


def remove_block(dash_id: str, user_id: str, block_id: str) -> None:
    with _mutate(dash_id, user_id) as dash:
        kept = [b for b in dash.blocks if b.block_id != block_id]
        if len(kept) == len(dash.blocks):
            raise BlockNotFound(block_id)
        dash.blocks = kept


# --- refresh ------------------------------------------------------------------------------------


def move_params(params: dict[str, Any], run_date: date, today: date) -> dict[str, Any]:
    """The saved params, moved forward to today.

    Relative params (`last="60d"`, `years=5`, ...) are returned unchanged: they already mean
    "ending now". A top-level `after` that is the ISO date of the original run becomes today's
    date (the run was "up to now" when it was made). `before` and every other date stay fixed.
    """
    moved = dict(params)
    if moved.get("after") == run_date.isoformat():
        moved["after"] = today.isoformat()
    return moved


def _pick(blocks: list[Block], saved: DashboardBlock) -> Block:
    """The re-run block that replaces `saved`: same type, preferring same id, then same position."""
    kind = saved.block.type
    same = [b for b in blocks if b.type == kind]
    index = saved.source.block_index
    for b in same:
        if b.id == saved.source.block_id:
            return b
    if index < len(blocks) and blocks[index].type == kind:
        return blocks[index]
    if len(same) == 1:
        return same[0]
    raise NoMatchingBlock(f"The script no longer produces a '{kind}' block like the saved one.")


async def refresh_block(dash_id: str, user_id: str, block_id: str) -> DashboardBlock:
    """Re-run the block's script (no LLM) and swap in the new block with a template caption.

    Raises `DashboardNotFound`, `BlockNotFound`, `RefreshFailed` (script failed or returned
    nothing; the saved block is untouched) or `NoMatchingBlock`.
    """
    dash = get_dashboard(dash_id, user_id)
    saved = next((b for b in dash.blocks if b.block_id == block_id), None)
    if saved is None:
        raise BlockNotFound(block_id)
    src = saved.source
    params = move_params(src.params, src.run_date, _today())
    outcome: RunOutcome = await run_script(
        src.script, params, run_id="d_" + secrets.token_hex(5), timeout_s=60
    )
    if not outcome.ok or outcome.result is None:
        raise RefreshFailed(
            outcome.error or ScriptError(kind="crash", message="The script returned nothing.")
        )
    new_block = _pick(outcome.result.blocks, saved)
    now = _now()
    with _mutate(dash_id, user_id) as fresh:
        target = next((b for b in fresh.blocks if b.block_id == block_id), None)
        if target is None:  # removed while the script ran
            raise BlockNotFound(block_id)
        target.block = new_block
        target.refreshed_at = now
        target.caption = _caption("Refreshed", now, new_block)
    return target
