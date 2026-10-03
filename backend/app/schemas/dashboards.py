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
    "BlockSourceOut",
    "DashboardBlock",
    "DashboardBlockOut",
    "DashboardCreate",
    "DashboardOut",
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
    block_id: str = Field(description="The block's id inside the source run, e.g. 'b2'.")
    block_type: str = Field(description="The block's type; a refresh must produce the same type.")
    block_title: str = Field(description="The block's title; a refresh must produce the same.")
    title_index: int = Field(
        description="Position among the run's blocks with this type and title (0-based)."
    )


class BlockSourceOut(BaseModel):
    """`BlockSource` as the API returns it: the stored script is kept server-side only."""

    run_id: str
    run_date: date
    params: dict[str, Any] = Field(default_factory=dict)
    block_id: str
    block_type: str
    block_title: str
    title_index: int


class DashboardBlock(BaseModel):
    """A saved block with the way to refresh it."""

    block_id: str = Field(description="Id on this dashboard (use it in the block URLs).")
    block: Block
    source: BlockSource
    refreshed_at: datetime = Field(description="When `block` was last produced. UTC.")
    caption: str | None = Field(None, description="Template text, e.g. 'Refreshed 3 Oct 2026: …'.")


class DashboardBlockOut(BaseModel):
    """A saved block as the API returns it (no script)."""

    block_id: str
    block: Block
    source: BlockSourceOut
    refreshed_at: datetime
    caption: str | None = None

    @classmethod
    def of(cls, saved: DashboardBlock) -> DashboardBlockOut:
        return cls(
            block_id=saved.block_id,
            block=saved.block,
            source=BlockSourceOut.model_validate(saved.source.model_dump(exclude={"script"})),
            refreshed_at=saved.refreshed_at,
            caption=saved.caption,
        )


class Dashboard(BaseModel):
    id: str
    user_id: str
    name: str
    created_at: datetime = Field(default_factory=_utcnow, description="UTC.")
    blocks: list[DashboardBlock] = Field(default_factory=list)


class DashboardOut(BaseModel):
    """A dashboard as the API returns it."""

    id: str
    user_id: str
    name: str
    created_at: datetime
    blocks: list[DashboardBlockOut]

    @classmethod
    def of(cls, dash: Dashboard) -> DashboardOut:
        return cls(
            id=dash.id,
            user_id=dash.user_id,
            name=dash.name,
            created_at=dash.created_at,
            blocks=[DashboardBlockOut.of(b) for b in dash.blocks],
        )


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
