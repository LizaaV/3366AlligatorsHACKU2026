"""Output blocks (HANDOFF B9, BUILD-PLAN I5): typed descriptions of visuals the frontend draws.

`Block` is a discriminated union on `type`. Build blocks with `earth.show.*` rather than by hand.
v1 types: then_now, timeline, scene_strip, highlight, hypotheses, stat, limits.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, TypeAdapter

from earth.types import Measure, Patch, Provenance

# Linking (B9.4): what shared UI state a block reads or writes.
#   "time": "cursor" (writes the time cursor) | "follow" (follows it)
#   "selection": "set" | "follow"
Links = dict[Literal["time", "selection", "measure"], Literal["cursor", "follow", "set"]]


class _BlockBase(BaseModel):
    id: str  # "b2", unique within a run
    primary: bool = False  # at most one per answer
    title: str
    caption: str | None = None  # follows the answer's number rule (B3.5)
    links: Links = {}
    provenance: list[Provenance] = []


# --- then_now -----------------------------------------------------------------------------------


class Image(BaseModel):
    """A rendered map image pinned to WGS84 bounds (from `earth.render`)."""

    layer_id: str
    url: str
    bounds: tuple[float, float, float, float]  # (west, south, east, north)
    date: date
    scene: str
    label: str  # "12 Mar 2026"


class ThenNowBlock(_BlockBase):
    type: Literal["then_now"] = "then_now"
    measure: Measure | None  # None = true colour
    before: Image
    after: Image
    outline: dict | None = None  # GeoJSON of the area, drawn on both images


# --- timeline -----------------------------------------------------------------------------------


class TimelinePoint(BaseModel):
    date: date
    value: float
    scene: str
    clean_px: int


class TimelineBand(BaseModel):
    month: int = Field(ge=1, le=12)
    lo: float
    hi: float


class TimelineMark(BaseModel):
    date: date
    label: str  # "change"


class TimelineSeries(BaseModel):
    """An extra line, e.g. the surroundings for local-vs-regional."""

    label: str
    data: list[TimelinePoint]


class TimelineBlock(_BlockBase):
    type: Literal["timeline"] = "timeline"
    measure: Measure
    unit: str | None = None  # "dB" for roughness; None = index value
    data: list[TimelinePoint]
    band: list[TimelineBand] = []  # normal seasonal range
    marks: list[TimelineMark] = []
    compare: list[TimelineSeries] = []


# --- scene_strip --------------------------------------------------------------------------------


class StripScene(BaseModel):
    scene: str
    date: date
    satellite: str
    cloud: float  # 0–1 over the area
    used: bool
    why: str | None = None  # "Cloudy over the area (71%)"


class SceneStripBlock(_BlockBase):
    type: Literal["scene_strip"] = "scene_strip"
    scenes: list[StripScene]  # oldest first


# --- highlight ----------------------------------------------------------------------------------


class HighlightBlock(_BlockBase):
    type: Literal["highlight"] = "highlight"
    measure: Measure
    patches: list[Patch]
    total_ha: float
    base: Image | None = None  # image the patches are drawn on


# --- hypotheses (expectation table, B3.3) -------------------------------------------------------


class HypothesisRow(BaseModel):
    card_id: str  # "pond_filling"
    label: str  # "Ponds filled in"
    expected: dict[str, str]  # measure → "↓↓ > 0.15, sudden"
    observed: dict[str, str]  # measure → "−0.31 on 12 Sep" (filled by code)
    verdict: Literal["supported", "contradicted", "unclear", "untested"]
    reason: str | None = None  # "change was sudden"
    score: float | None = None


class HypothesesBlock(_BlockBase):
    type: Literal["hypotheses"] = "hypotheses"
    rows: list[HypothesisRow]  # ranked, best first
    post_hoc: bool = False  # True if registered after data was read


# --- stat ---------------------------------------------------------------------------------------


class StatBlock(_BlockBase):
    type: Literal["stat"] = "stat"
    label: str  # "Area changed"
    value: float
    unit: str  # "ha"
    lo: float | None = None
    hi: float | None = None


# --- limits (B7.5) ------------------------------------------------------------------------------


class LimitAction(BaseModel):
    label: str  # "Check with radar"
    kind: Literal["radar", "wait", "enlarge", "expert", "other"]


class LimitsBlock(_BlockBase):
    type: Literal["limits"] = "limits"
    cant_tell: str  # what it can't tell, and why (one line)
    actions: list[LimitAction] = []  # what it can do instead
    contacts: list[str] = []  # "Planning Department", "emergency services"
    rule_id: str | None = None  # policy rule, for refusals


Block = Annotated[
    ThenNowBlock
    | TimelineBlock
    | SceneStripBlock
    | HighlightBlock
    | HypothesesBlock
    | StatBlock
    | LimitsBlock,
    Field(discriminator="type"),
]

BlockAdapter: TypeAdapter[Block] = TypeAdapter(Block)
BLOCK_TYPES = (
    "then_now",
    "timeline",
    "scene_strip",
    "highlight",
    "hypotheses",
    "stat",
    "limits",
)


def validate_block(data: dict) -> Block:
    """Parse a dict (e.g. from a sandboxed script) into a typed block. Raises ValidationError."""
    return BlockAdapter.validate_python(data)
