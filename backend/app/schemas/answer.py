"""The final answer card (mirrors frontend `Answer` in src/data/agent.ts, HANDOFF B10.3)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from earth.blocks import Block


class StatItem(BaseModel):
    """One headline number."""

    l: str = Field(description="Label, e.g. 'Dry area'.")  # noqa: E741 (frontend key)
    v: str = Field(description="Value with unit, e.g. '4.6 ha'.")
    ci: str | None = Field(None, description="Uncertainty, e.g. '90% range 3.9–5.3'.")


class Confidence(BaseModel):
    """How sure the answer is, with a one-line reason."""

    level: Literal["High", "Medium", "Low"]
    pct: int = Field(ge=0, le=100)
    note: str


class RouteOption(BaseModel):
    """A data source considered for the question and what happened to it."""

    sat: str
    status: Literal["chosen", "support", "skipped", "fallback"]
    why: str


class ProofScene(BaseModel):
    """A satellite scene that was looked at, and whether it was used."""

    id: str
    date: str
    sat: str
    cloud: float = Field(description="Cloud over the area, percent.")
    used: bool
    why: str | None = Field(None, description="Why it was skipped, when not used.")


class CardRef(BaseModel):
    """A knowledge card used by the method, pinned to a version."""

    id: str
    version: int
    status: Literal["draft", "tested", "reviewed"]


class SkillRef(BaseModel):
    """A skill used by the method, pinned to a version."""

    id: str
    version: int


class Method(BaseModel):
    """What produced the answer: cards, skill and code reference."""

    cards: list[CardRef] = Field(default_factory=list)
    skill: SkillRef | None = None
    code_ref: str | None = Field(None, description="Reference to the script that ran.")
    model: str | None = Field(
        None, description="LLM model id behind the answer; None for presets and templates."
    )


class Answer(BaseModel):
    """The final answer for a run.

    Frontend mapping (src/data/agent.ts `Answer`): same names, except `skill_id` → `skillId`
    and `suggested_skills` → `suggested`. Fields the frontend does not show yet (`sentence`,
    `blocks`, `followups`, `method`, ...) are extra.
    """

    kind: Literal["place", "general"] = Field(
        "place",
        description="'place' = about an area (shows 'Keep watching'); 'general' = no area, "
        "shows `suggested_skills` instead.",
    )
    title: str = Field(description="Headline, e.g. 'About 4.6 ha of the ponds are now dry'.")
    eyebrow: str | None = Field(None, description="Small label above the title, e.g. place name.")
    color: str | None = Field(
        None, pattern=r"^#[0-9a-fA-F]{6}$", description="Colour square next to the eyebrow."
    )
    sentence: str = Field(description="One-sentence answer in plain words.")
    l1: str = Field("Likely cause", description="Label above `cause`.")
    cause: str | None = Field(
        None, description="Likely cause in plain words; None for measure-only answers."
    )
    l2: str = Field("What to do", description="Label above `todo`.")
    todo: str | None = Field(None, description="What to do next.")
    stats: list[StatItem] = Field(default_factory=list)
    confidence: Confidence
    caveats: list[str] = Field(default_factory=list)
    route: list[RouteOption] = Field(default_factory=list)
    proof: list[ProofScene] = Field(default_factory=list)
    blocks: list[Block] = Field(default_factory=list)
    followups: list[str] = Field(default_factory=list, max_length=3)
    method: Method = Field(default_factory=Method)
    skill_id: str | None = Field(None, description="Skill that produced it (frontend `skillId`).")
    suggested_skills: list[str] = Field(
        default_factory=list, description="Skill ids for general answers (frontend `suggested`)."
    )
    measure_only: bool = Field(False, description="True when no knowledge card matched.")
    preset: bool = Field(False, description="True when served from cached/stub preset data.")
    hash: str = Field(description="Reproducibility hash of method + scenes.")
