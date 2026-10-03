"""Skills API shapes: library, manifest, builder and test (issue #41). snake_case throughout.

`ProofScene` (answer card) and `Provenance` (earth) are reused, not redefined, so a skill test
and a run describe scenes and sources the same way.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

import earth
from app.schemas.answer import ProofScene
from app.schemas.catalog import ParamValue, Tier
from app.schemas.runs import SafeId

#: `available` = backed by a script in `backend/skills/<id>/` that the backend runs;
#: `concept` = library entry carried over from the design prototype, no implementation yet;
#: `draft` = made in the skill builder, a module recipe with no executor yet.
SkillStatus = Literal["available", "concept", "draft"]
Visibility = Literal["private", "team", "public"]
ParamKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}$")]
ModuleId = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_.-]{0,39}$")]


class Publisher(BaseModel):
    name: str
    official: bool = False
    verified: bool = False


class LatLon(BaseModel):
    lat: float
    lon: float


class SkillDto(BaseModel):
    """One library entry."""

    id: str
    category_key: str
    name: str
    sat: str = Field(description="Human-readable satellite list, for display.")
    cost: str
    tier: Tier
    short: str
    long: str = ""
    publisher: Publisher
    reference: LatLon | None = Field(None, description="Where to take the card thumbnail.")
    res: str | None = None
    revisit: str | None = None
    runs: int | None = Field(
        None, description="Measured run count; null until the backend counts runs per skill."
    )
    rating: float | None = Field(
        None, description="Measured user rating; null until ratings exist."
    )
    version: str = Field(description="Semver of the skill recipe.")
    updated_at: str = Field(description="ISO-8601 instant.")
    steps: list[str] = Field(description="Ordered module ids (see the manifest for params).")
    accuracy: str | None = Field(
        None, description="Validation statement; null when the skill has not been validated."
    )
    limits: list[str] = Field(default_factory=list)
    status: SkillStatus
    visibility: Visibility = "public"


class SkillStep(BaseModel):
    module: ModuleId = Field(description="A `SkillModuleDto.id` from `GET /api/catalog`.")
    params: dict[ParamKey, ParamValue] = Field(default_factory=dict, max_length=20)


class SkillInput(BaseModel):
    key: str
    type: str
    required: bool = False
    accepts: list[str] | None = None


class SkillOutput(BaseModel):
    key: str
    type: str
    languages: str | None = None
    with_confidence: bool | None = None


class Pricing(BaseModel):
    tier: Tier
    price: str | None = None


class ManifestAccuracy(BaseModel):
    resolution: str | None = None
    revisit: str | None = None
    statement: str | None = None
    known_limits: list[str] = Field(default_factory=list)


class SkillManifest(BaseModel):
    """The reproducible recipe behind a skill.

    `code_ref` is the same string a run puts in `Answer.method.code_ref` when this skill
    produced it, and `code_sha256` pins the exact script. Both are null for skills with no
    implementation (`status` 'concept' or 'draft').
    """

    id: str
    version: str
    name: str
    category_key: str
    status: SkillStatus
    visibility: Visibility
    publisher: Publisher
    pricing: Pricing
    inputs: list[SkillInput] = Field(default_factory=list)
    steps: list[SkillStep]
    outputs: list[SkillOutput] = Field(default_factory=list)
    accuracy: ManifestAccuracy
    code_ref: str | None = Field(None, description="Script that implements the skill.")
    code_sha256: str | None = Field(None, description="SHA-256 of that script.")


class CreateSkillRequest(BaseModel):
    """Skill builder. Every step's `module` must exist in `GET /api/catalog` modules and
    `category_key` in its categories; otherwise 422."""

    name: str = Field(min_length=1, max_length=80)
    category_key: str = Field(min_length=1, max_length=40)
    short: str = Field(min_length=1, max_length=200)
    long: str = Field("", max_length=2000)
    tier: Tier = "free"
    cost: str = Field("Free", max_length=40)
    visibility: Visibility = "private"
    steps: list[SkillStep] = Field(min_length=1, max_length=20)


class SkillTestRequest(BaseModel):
    """Dry-run a draft recipe against one saved place."""

    place_id: SafeId
    steps: list[SkillStep] = Field(min_length=1, max_length=20)


class SkillTestResult(BaseModel):
    """Planned response of `POST /api/skills/test` (the endpoint answers 501 for now)."""

    ok: bool
    summary: str
    issues: list[str] = Field(default_factory=list)
    scenes: list[ProofScene] = Field(
        default_factory=list, description="Every scene looked at, used or not, and why."
    )
    provenance: list[earth.Provenance] = Field(default_factory=list)
    reproducible: bool = Field(description="Same inputs give the same hash.")
    hash: str | None = None


class NotAvailable(BaseModel):
    """Error detail for a feature that is not built yet (same keys as earth errors)."""

    kind: Literal["not_implemented"] = "not_implemented"
    message: str
    hint: str


class NotAvailableResponse(BaseModel):
    detail: NotAvailable
