"""Read-only knowledge-base contract for the frontend Method view and Library."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CardIndexEntry(BaseModel):
    """One line of the knowledge index: an event or setting card."""

    id: str = Field(description="Card id, e.g. 'pond_filling'.")
    type: Literal["event", "setting"]
    name: str
    summary: str
    status: Literal["draft", "tested", "reviewed"]
    version: int
    aliases: list[str] = Field(default_factory=list)


class CardDetail(BaseModel):
    """A full card: index entry, validated YAML header and Markdown body."""

    entry: CardIndexEntry
    header: dict[str, Any] = Field(description="The validated card header, as JSON.")
    body_markdown: str
