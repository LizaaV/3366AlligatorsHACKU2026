"""The skills a user has installed (a per-user list of skill ids)."""

from __future__ import annotations

from pydantic import BaseModel, Field

__all__ = ["InstalledSkills"]


class InstalledSkills(BaseModel):
    installed: list[str] = Field(description="Skill ids the user installed, oldest first.")
