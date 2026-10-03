"""Chat projects: folders that group a user's conversations (threads)."""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

__all__ = ["Project", "ProjectCreate", "ProjectUpdate", "ThreadProjectUpdate", "new_project_id"]

ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


def new_project_id() -> str:
    """ "prj_" + 12 lowercase hex."""
    return "prj_" + secrets.token_hex(6)


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Project(BaseModel):
    """One project (folder) of the user's chats."""

    id: str
    name: str
    created_at: datetime = Field(default_factory=_utcnow, description="UTC.")
    updated_at: datetime = Field(default_factory=_utcnow, description="UTC, last rename.")


class ProjectCreate(BaseModel):
    name: ProjectName


class ProjectUpdate(BaseModel):
    name: ProjectName


class ThreadProjectUpdate(BaseModel):
    """Body of `PATCH /api/threads/{thread_id}`: file the chat in a project, or unfile it."""

    project_id: str | None = Field(description="The project to move the chat into; null unfiles.")
