"""Memory API shapes. `PlaceMemory` is the store's own model (app/services/memory.py)."""

from pydantic import BaseModel, Field

from app.services.memory import ID_RE, PlaceMemory

__all__ = ["InsightCreate", "InsightSaved", "MeMemory", "MePatch", "MemoryPatch", "PlaceMemory"]


class MemoryPatch(BaseModel):
    """User edits on the Places page. The LLM never calls this."""

    profile: dict[str, str] | None = Field(default=None, max_length=30)
    note: str | None = Field(default=None, max_length=1000)


class MeMemory(BaseModel):
    profile: dict[str, str]


class MePatch(BaseModel):
    profile: dict[str, str] = Field(max_length=30)


class InsightCreate(BaseModel):
    place_id: str = Field(pattern=ID_RE.pattern)
    text: str = Field(min_length=1, max_length=1000)
    confidence: str = Field(default="", max_length=40)


class InsightSaved(BaseModel):
    run_id: str
    place_id: str
    saved: bool = True
