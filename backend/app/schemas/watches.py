"""Watch API shapes (issue #40): standing questions re-asked on every satellite pass.

snake_case throughout (team convention). Dates are ISO instants (UTC).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.answer import Confidence, ProofScene
from app.schemas.runs import SafeId

__all__ = [
    "Channel",
    "ConfidenceLevel",
    "CreateWatchRequest",
    "FeasibilityDto",
    "FeasibilityRequest",
    "PatchWatchRequest",
    "Recurrence",
    "Tier",
    "WatchDto",
    "WatchEvent",
    "WatchProofDto",
    "WatchSeries",
    "WatchStatus",
]

#: Same `High | Medium | Low` the runs contract uses on `Answer.confidence.level`.
ConfidenceLevel = Confidence.model_fields["level"].annotation
Tier = Literal["free", "paid"]
WatchStatus = Literal["ok", "warn", "alert"]
WatchEventLevel = Literal["info", "warn", "alert"]
Channel = Literal["email", "whatsapp", "sms", "push", "slack"]
Recurrence = Literal["recurring", "once"]

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]
Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
Key = Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)]


class WatchSeries(BaseModel):
    """History of the watched metric, one point per pass, in **real units** (`unit`).

    The chart normalises for drawing; the API never sends 0..1-scaled values. All arrays have
    the same length as `labels`. Empty until the watch has real runs.
    """

    unit: str = Field("", description="Unit of every value below, e.g. 'ha'; '' = unitless.")
    labels: list[str] = Field(default_factory=list, description="ISO date of each pass.")
    current: list[float] = Field(default_factory=list, description="Measured value per pass.")
    band_low: list[float] = Field(default_factory=list, description="Baseline band, low edge.")
    band_high: list[float] = Field(default_factory=list, description="Baseline band, high edge.")
    mean: list[float] = Field(default_factory=list, description="Baseline mean per pass.")


class WatchEvent(BaseModel):
    at: datetime
    text: str
    level: WatchEventLevel


class WatchDto(BaseModel):
    """A saved watch.

    Measurement fields (`value`, `ci`, `baseline`, `status`, `last_run_at`, `series`) are
    `null`/empty until a real run has produced them — the API never invents numbers.
    `enabled: false` means paused; `next_run_at: null` with `enabled: true` means "not
    scheduled yet" (there is no scheduler yet, so it is always null for now).
    """

    id: str
    name: str
    category_key: str = ""
    place_id: str | None = Field(None, description="Null for a general watch, or place deleted.")
    skill_id: str = ""
    question: str
    condition: str = ""
    metric: str = ""
    value: float | None = None
    unit: str = ""
    ci: tuple[float, float] | None = Field(None, description="90% interval [low, high].")
    confidence: ConfidenceLevel = Field(description="Expected confidence for this question.")
    baseline_label: str = ""
    baseline: float | None = None
    delta: str = ""
    status: WatchStatus | None = Field(None, description="Null until the first real run.")
    enabled: bool = True
    recurrence: Recurrence = Field(
        "recurring",
        description="'once' triggers disable themselves (`enabled: false`) after their first "
        "alert-level event; 'recurring' keeps firing.",
    )
    dashboard_id: str | None = Field(None, description="Optional linked dashboard.")
    series: WatchSeries = Field(default_factory=WatchSeries)
    channels: list[Channel] = Field(default_factory=list)
    cadence: str = ""
    tier: Tier = "free"
    satellites: str = ""
    ring: bool = False
    last_run_at: datetime | None = None
    next_run_at: datetime | None = None
    events: list[WatchEvent] = Field(default_factory=list, description="Newest first.")
    created_at: datetime
    updated_at: datetime


def _dedupe(v: list[str] | None) -> list[str] | None:
    return None if v is None else list(dict.fromkeys(v))


class CreateWatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    category_key: Key = ""
    place_id: SafeId | None = None
    skill_id: Key = ""
    question: Question
    condition: Text = ""
    channels: list[Channel] = Field(default_factory=list, max_length=5)
    cadence: Text = ""
    recurrence: Recurrence = "recurring"
    dashboard_id: SafeId | None = None

    _channels = field_validator("channels")(_dedupe)


class PatchWatchRequest(BaseModel):
    """Every field optional; unknown fields and explicit nulls are rejected (422)."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    name: Name | None = None
    condition: Text | None = None
    channels: list[Channel] | None = Field(default=None, max_length=5)
    cadence: Text | None = None
    recurrence: Recurrence | None = None
    dashboard_id: SafeId | None = None  # explicit null unlinks the dashboard

    _channels = field_validator("channels")(_dedupe)

    @field_validator(
        "enabled", "name", "condition", "channels", "cadence", "recurrence", mode="before"
    )
    @classmethod
    def _no_null(cls, v: object) -> object:
        if v is None:
            raise ValueError("may be omitted but not null")
        return v


class WatchProofDto(BaseModel):
    """Scenes behind the watch's most recent run (the runs contract's `ProofScene`), plus the
    reproducibility hash. Empty `scenes` and `hash: ""` until the watch has run."""

    scenes: list[ProofScene] = Field(default_factory=list)
    hash: str = ""


class FeasibilityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: Question
    place_id: SafeId | None = None


class FeasibilityDto(BaseModel):
    """'Can satellites actually watch this?', asked before a watch is created."""

    ok: bool
    partial: bool = Field(
        False, description="Answerable only with paid imagery or lower confidence."
    )
    title: str
    skill_id: str = ""
    category_key: str = ""
    metric: str = ""
    condition: str = ""
    satellites: str = "—"
    cadence: str = "—"
    tier: Tier = "free"
    cost: str = "—"
    confidence: ConfidenceLevel
    notes: list[str] = Field(default_factory=list)
    alternative: str | None = Field(None, description="Offered when `ok` is false.")
