"""Dashboards (BUILD-PLAN M8): saved blocks that refresh by re-running their script."""

from __future__ import annotations

import secrets
from datetime import UTC, date, datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.runs import SafeId
from earth.blocks import Block

__all__ = [
    "BlockSource",
    "Dashboard",
    "DashboardBlock",
    "DashboardCreate",
    "DashboardSummary",
    "DashboardUpdate",
    "SaveBlockRequest",
    "new_block_id",
    "new_dashboard_id",
]

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


def new_dashboard_id() -> str:
    """ "dash_" + 12 lowercase hex."""
    return "dash_" + secrets.token_hex(6)


def new_block_id() -> str:
    """ "blk_" + 12 lowercase hex: the id of a block on a dashboard (not the run's block id)."""
    return "blk_" + secrets.token_hex(6)


def _utcnow() -> datetime:
    return datetime.now(UTC)


class BlockSource(BaseModel):
    """What produced a saved block: enough to run it again without the LLM."""

    run_id: str
    run_date: date = Field(description="Day the source run was made (UTC); see refresh rule.")
    script: str
    params: dict[str, Any] = Field(default_factory=dict)
    block_index: int = Field(description="Position of the block in the run's blocks.")
    block_id: str = Field(description="The block's id inside the source run, e.g. 'b2'.")


class DashboardBlock(BaseModel):
    """A saved block with the way to refresh it."""

    block_id: str = Field(description="Id on this dashboard (use it in the block URLs).")
    block: Block
    source: BlockSource
    refreshed_at: datetime = Field(description="When `block` was last produced. UTC.")
    caption: str | None = Field(None, description="Template text, e.g. 'Refreshed 3 Oct 2026: …'.")


class Dashboard(BaseModel):
    id: str
    user_id: str
    name: str
    created_at: datetime = Field(default_factory=_utcnow, description="UTC.")
    blocks: list[DashboardBlock] = Field(default_factory=list)


class DashboardSummary(BaseModel):
    """A dashboard entry for the list."""

    id: str
    name: str
    created_at: datetime
    block_count: int


class DashboardCreate(BaseModel):
    name: Name


class DashboardUpdate(BaseModel):
    name: Name


class SaveBlockRequest(BaseModel):
    """Save one block of a run to a dashboard."""

    run_id: SafeId
    block_id: str = Field(description="The block's `id` in the run, e.g. 'b2'.", max_length=64)
