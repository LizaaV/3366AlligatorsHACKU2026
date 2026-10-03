"""Pydantic models for knowledge cards (events, settings) and policy files.

The models check the shape of one file at a time. Cross-file rules (links between cards,
look-alike symmetry, policy references) live in ``loader.py``.
"""

import datetime as dt
import re
from typing import Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# --- Measures -------------------------------------------------------------------------------

MeasureV1 = Literal["greenness", "moisture", "water", "bare", "burn", "roughness"]
MeasureContext = Literal["slope_deg", "elevation_m", "rain_mm", "land_cover"]
MeasurePlanned = Literal["heat", "fire"]

MEASURES_V1: tuple[str, ...] = get_args(MeasureV1)
"""Indices available now in the ``earth`` library (must equal ``earth.types.Measure``)."""
MEASURES_CONTEXT: tuple[str, ...] = get_args(MeasureContext)
"""Values from ``earth.describe`` / context providers."""
MEASURES_PLANNED: tuple[str, ...] = get_args(MeasurePlanned)
"""May be missing at demo time: signs using them must be optional."""
ALL_MEASURES: tuple[str, ...] = MEASURES_V1 + MEASURES_CONTEXT + MEASURES_PLANNED

# --- Other enumerations ---------------------------------------------------------------------

BlockType = Literal[
    "then_now",
    "timeline",
    "scene_strip",
    "highlight",
    "hypotheses",
    "stat",
    "limits",
    "map_layer",
    "timelapse",
    "compare",
]
BLOCK_TYPES: tuple[str, ...] = get_args(BlockType)

Category = Literal[
    "agriculture", "water", "forests", "disasters", "urban", "oceans", "air", "finance", "society"
]
CATEGORIES: tuple[str, ...] = get_args(Category)

WORLDCOVER_CODES: dict[int, str] = {
    10: "tree cover",
    20: "shrubland",
    30: "grassland",
    40: "cropland",
    50: "built-up",
    60: "bare/sparse vegetation",
    70: "snow and ice",
    80: "permanent water bodies",
    90: "herbaceous wetland",
    95: "mangroves",
    100: "moss and lichen",
}

Status = Literal["draft", "tested", "reviewed"]
Timing = Literal["sudden", "gradual", "seasonal", "any"]
Change = Literal["down", "up", "stable", "inside_band", "outside_band", "above", "below"]
Spatial = Literal["local", "regional", "any"]
LocationPrecision = Literal["exact", "approximate"]
Expected = Literal["detected", "not_detected"]

RuleKind = Literal[
    "not_allowed", "out_of_scope", "feasibility", "uncertain", "emergency", "off_topic", "abuse"
]
RuleAction = Literal["block", "partial", "redirect", "ask"]
CheckType = Literal["output_must_not_contain", "area_overlaps_osm", "max_area_km2", "min_area_ha"]
TestAction = Literal["block", "partial", "redirect", "ask", "allow"]

EVENT_SECTIONS: tuple[str, ...] = (
    "## What it is",
    "## How it shows up from space",
    "## How to tell it apart",
    "## Limits",
    "## Sources",
)
SETTING_SECTIONS: tuple[str, ...] = (
    "## What it is",
    "## What normal looks like",
    "## Pitfalls",
)

_DATE_RE = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- Event card parts -----------------------------------------------------------------------


class Sign(_Strict):
    measure: str
    change: Change
    by_more_than: float | None = Field(default=None, ge=0)
    threshold: float | None = None
    timing: Timing | None = None
    spatial: Spatial | None = None
    shape: str | None = None
    weight: int = Field(ge=1, le=3)
    optional: bool = False
    note: str | None = None

    @model_validator(mode="after")
    def _threshold_for_above_below(self) -> "Sign":
        if self.change in ("above", "below") and self.threshold is None:
            raise ValueError(f"change '{self.change}' needs a threshold")
        return self


class Trigger(_Strict):
    """Either ``{event, note}`` or ``{measure, above, window_days, note}``."""

    event: str | None = None
    measure: str | None = None
    above: float | None = None
    window_days: int | None = Field(default=None, ge=1)
    note: str | None = None

    @model_validator(mode="after")
    def _event_xor_measure(self) -> "Trigger":
        if (self.event is None) == (self.measure is None):
            raise ValueError("a trigger needs exactly one of 'event' or 'measure'")
        if self.measure is not None and self.above is None:
            raise ValueError("a measure trigger needs 'above'")
        if self.event is not None and (self.above is not None or self.window_days is not None):
            raise ValueError("an event trigger takes only 'event' and 'note'")
        return self


class LookAlike(_Strict):
    event: str
    tell_apart_by: str
    discriminating_measures: list[str] = Field(default_factory=list)


class Case(_Strict):
    place: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    location_precision: LocationPrecision
    date: str
    expected: Expected
    source: str | None = None
    url: str | None = None
    verified: bool = False
    note: str | None = None

    @field_validator("date", mode="before")
    @classmethod
    def _date_to_str(cls, v: Any) -> Any:
        # YAML turns an unquoted 2023-09-08 into a date object.
        if isinstance(v, dt.date):
            return v.isoformat()
        return v

    @field_validator("date")
    @classmethod
    def _date_format(cls, v: str) -> str:
        if not _DATE_RE.match(v):
            raise ValueError("date must be YYYY-MM-DD or YYYY-MM")
        return v


class Source(_Strict):
    title: str
    url: str


class Confidence(_Strict):
    high_min_weight: int = Field(ge=1)
    medium_min_weight: int = Field(ge=1)


class Wording(_Strict):
    use: list[str] = Field(default_factory=list)
    avoid: list[str] = Field(default_factory=list)


class EventCard(_Strict):
    id: str
    type: Literal["event"]
    version: int = Field(ge=1)
    status: Status
    name: str
    aliases: list[str] = Field(default_factory=list)
    category: Category
    summary: str
    min_size_m: float = Field(gt=0)
    timing: Timing
    occurs_in: list[str] = Field(min_length=1)
    triggered_by: list[Trigger] = Field(default_factory=list)
    signs: list[Sign] = Field(min_length=3)
    looks_like: list[LookAlike] = Field(default_factory=list)
    cannot_tell: list[str]
    confidence: Confidence
    suggested_blocks: list[BlockType] = Field(default_factory=list)
    wording: Wording | None = None
    cases: list[Case] = Field(default_factory=list)
    controls: list[Case] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)


# --- Setting card parts ---------------------------------------------------------------------


class NormalRange(_Strict):
    measure: str
    typical_min: float | None = None
    typical_max: float | None = None
    seasonality: str | None = None


class Detect(_Strict):
    land_cover_any: list[int] = Field(default_factory=list)
    min_fraction: float | None = Field(default=None, ge=0, le=1)
    slope_deg_mean_gt: float | None = None
    note: str | None = None


class SettingCard(_Strict):
    id: str
    type: Literal["setting"]
    version: int = Field(ge=1)
    status: Status
    name: str
    aliases: list[str] = Field(default_factory=list)
    summary: str
    worldcover_classes: list[int] = Field(default_factory=list)
    detect: Detect
    normal: list[NormalRange] = Field(default_factory=list)
    likely_events: list[str] = Field(default_factory=list)
    pitfalls: list[str] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)


# --- Policy ---------------------------------------------------------------------------------


class PolicyCheck(_Strict):
    type: CheckType
    value: str | float | int


class PolicyRule(_Strict):
    id: str
    kind: RuleKind
    action: RuleAction
    description: str
    examples: list[str] = Field(min_length=3)
    not_examples: list[str] = Field(min_length=2)
    checks: list[PolicyCheck] = Field(default_factory=list)
    reply: str
    alternatives: bool
    log: bool
    version: int = Field(ge=1)


class Template(_Strict):
    text: str
    alternatives: list[str] = Field(default_factory=list)
    contacts: list[str | dict[str, Any]] = Field(default_factory=list)


class PolicyTestCase(_Strict):
    question: str
    place: str | None = None
    expected_rule: str | None
    expected_action: TestAction
    note: str | None = None


class Policy(_Strict):
    rules: list[PolicyRule] = Field(default_factory=list)
    templates: dict[str, Template] = Field(default_factory=dict)
    tests: list[PolicyTestCase] = Field(default_factory=list)


class RulesFile(_Strict):
    version: int = Field(ge=1)
    rules: list[PolicyRule]


class TemplatesFile(_Strict):
    version: int = Field(ge=1)
    templates: dict[str, Template]


class TestsFile(_Strict):
    __test__ = False  # not a pytest class

    version: int = Field(ge=1)
    cases: list[PolicyTestCase]
