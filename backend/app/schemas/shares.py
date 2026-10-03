"""Share links (BUILD-PLAN M6): a public, read-only snapshot of one run."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

import earth
from app.schemas.answer import Answer, Method
from app.schemas.runs import Step
from earth.blocks import Block

__all__ = ["ShareCreated", "ShareInfo", "SharedRun"]


class ShareCreated(BaseModel):
    """A new share link."""

    slug: str = Field(description="Unguessable id of the link.")
    url: str = Field(description="Public page, `<PUBLIC_BASE_URL>/proof/<slug>`.")
    expires_at: datetime = Field(description="UTC. After this the link answers 410.")


class ShareInfo(ShareCreated):
    """A share link as listed to its owner."""

    shared_at: datetime
    revoked: bool = False


class SharedRun(BaseModel):
    """What a share link shows: a copy of the run taken when it was shared.

    Deliberately left out: user id, thread id, the event log, params (they hold clarification
    answers, which may come from place memory), the script, and any place memory.
    """

    question: str
    lang: str = "en"
    area: earth.Area | None = Field(None, description="What was asked about (outline).")
    created_at: datetime = Field(description="When the run was made. UTC.")
    answer: Answer | None = None
    blocks: list[Block] = Field(default_factory=list)
    steps: list[Step] = Field(default_factory=list)
    provenance: list[earth.Provenance] = Field(default_factory=list)
    method: Method = Field(default_factory=Method, description="Cards and skill with versions.")
    shared_at: datetime = Field(description="When the snapshot was taken. UTC.")
    expires_at: datetime = Field(description="UTC.")
