"""Memory API shapes. `PlaceMemory` is the store's own model (app/services/memory.py)."""

from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

from app.services.memory import ID_RE, PlaceMemory

MAX_PROFILE_KEYS = 50  # total keys stored per place / per user; enforced in the route
MAX_KEY, MAX_VALUE = 40, 300


def _check_profile(d: dict[str, str]) -> dict[str, str]:
    for k, v in d.items():
        if len(k) > MAX_KEY or len(v) > MAX_VALUE:
            raise ValueError(f"profile keys max {MAX_KEY} chars, values max {MAX_VALUE}")
    return d


Profile = Annotated[dict[str, str], Field(max_length=30), AfterValidator(_check_profile)]

__all__ = ["InsightCreate", "InsightSaved", "MeMemory", "MePatch", "MemoryPatch", "PlaceMemory"]


class MemoryPatch(BaseModel):
    """User edits on the Places page. The LLM never calls this."""

    profile: Profile | None = None
    note: str | None = Field(default=None, max_length=1000)


class MeMemory(BaseModel):
    profile: dict[str, str]


class MePatch(BaseModel):
    profile: Profile


class InsightCreate(BaseModel):
    place_id: str = Field(pattern=ID_RE.pattern)
    text: str = Field(min_length=1, max_length=1000)
    confidence: str = Field(default="", max_length=40)


class InsightSaved(BaseModel):
    run_id: str
    place_id: str
    saved: bool = True
