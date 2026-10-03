"""Run requests and the stored run record (BUILD-PLAN I4)."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints

import earth
from app.schemas.answer import Answer, Method
from app.schemas.areas import AreaInput
from app.schemas.stream import RunStatus, StreamEvent
from earth.blocks import Block

__all__ = [
    "ID_PATTERN",
    "USER_ID_PATTERN",
    "Cost",
    "ReplyRequest",
    "RunRecord",
    "RunRequest",
    "RunStatus",
    "RunSummary",
    "Step",
    "new_run_id",
    "new_thread_id",
]

#: Run, thread and place ids. Same rule as `app.services.memory.ID_RE` (leading [a-z0-9]),
#: so an id the API accepts never makes memory raise mid-run.
ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{0,63}$"
#: The demo user id (`X-User-Id`): the same rule, at most 32 characters.
USER_ID_PATTERN = r"^[a-z0-9][a-z0-9_-]{0,31}$"
Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
SafeId = Annotated[str, StringConstraints(pattern=ID_PATTERN)]
LANG_PATTERN = r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$"
Lang = Annotated[str, StringConstraints(pattern=LANG_PATTERN)]


def new_run_id() -> str:
    """A new run id: "r_" + 12 lowercase hex (safe as a folder name)."""
    return "r_" + secrets.token_hex(6)


def new_thread_id() -> str:
    """A new thread id: "t_" + 12 lowercase hex."""
    return "t_" + secrets.token_hex(6)


def _utcnow() -> datetime:
    return datetime.now(UTC)


class RunRequest(BaseModel):
    """Start a run: a question, optionally about an area or saved place, in a thread."""

    question: Question
    area: AreaInput | None = None
    place_id: SafeId | None = Field(None, description="A saved place id.")
    thread_id: SafeId | None = Field(
        None,
        description="Continue a thread the server issued (from `run_started`); 404 if this "
        "user has no runs in it. Omit to start a new thread.",
    )
    skill_id: str | None = Field(None, description="Force a specific skill.")
    lang: Lang = Field(
        "en",
        description="Language for the answer text (BCP 47, e.g. 'en', 'zh-Hant', 'yue'). "
        "Stored on the run; answers are English until translation lands.",
    )


class ReplyRequest(BaseModel):
    """Answers to clarification questions, keyed by question key."""

    answers: dict[str, str] = Field(max_length=20)
    remember: bool = Field(True, description="Save the answers to the place profile.")


class Step(BaseModel):
    """A visible reasoning step as stored on the run."""

    index: int
    title: str
    desc: str
    tool: str
    result: str | None = None
    ms: int | None = None
    provenance: earth.Provenance | None = None
    error: str | None = None


class Cost(BaseModel):
    """LLM token usage and cost for a run."""

    input_tokens: int = 0
    output_tokens: int = 0
    usd: float = 0.0


class RunRecord(BaseModel):
    """Everything about a run, enough to replay it exactly (BUILD-PLAN I4)."""

    run_id: str
    thread_id: str
    user_id: str
    place_ids: list[str] = Field(default_factory=list)
    question: str
    lang: Lang = Field("en", description="Requested answer language (from `RunRequest.lang`).")
    area: earth.Area | None = Field(
        None, description="The area the run is about (stored once; None = demo preset)."
    )
    status: RunStatus
    created_at: datetime = Field(default_factory=_utcnow, description="UTC.")
    answer: Answer | None = None
    blocks: list[Block] = Field(default_factory=list)
    steps: list[Step] = Field(default_factory=list)
    provenance: list[earth.Provenance] = Field(default_factory=list)
    method: Method = Field(default_factory=Method)
    script: str | None = Field(None, description="Last successful script (dashboard refresh).")
    params: dict[str, Any] = Field(default_factory=dict)
    cost: Cost | None = None
    events: list[StreamEvent] = Field(
        default_factory=list, description="Full event log, for replay."
    )


class RunSummary(BaseModel):
    """A short run entry for listings."""

    run_id: str
    thread_id: str
    question: str
    status: RunStatus
    created_at: datetime
    sentence: str | None = Field(None, description="The answer sentence, if any.")
