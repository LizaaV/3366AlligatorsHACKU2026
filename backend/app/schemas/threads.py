"""Threads (A4): a user's conversations, each a list of runs sharing a `thread_id`."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.runs import RunRecord, RunStatus


class ThreadSummary(BaseModel):
    """One conversation in the user's history list."""

    thread_id: str
    title: str = Field(description="The thread's first question (shortened).")
    place_name: str | None = Field(None, description="The place of the latest run, if any.")
    last_question: str
    last_status: RunStatus
    last_sentence: str | None = Field(None, description="The latest answer's one-liner.")
    run_count: int
    started_at: datetime = Field(description="UTC, first run.")
    updated_at: datetime = Field(description="UTC, latest run.")


class ThreadDetail(BaseModel):
    """A whole conversation, oldest run first, to reload it exactly."""

    thread_id: str
    runs: list[RunRecord] = Field(description="Without the agent's private state.")
