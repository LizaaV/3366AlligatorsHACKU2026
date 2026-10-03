"""Watch records and the feasibility check (issue #40).

Storage mirrors `places.py`: one JSON file per user, `<EARTH_DATA_DIR>/watches/<user_id>.json`.
No demo seed: watches carry measured values, and there are no real runs to take them from yet.

Feasibility is a deterministic rule table (no LLM), built from the cases in
`docs/data/watch-feasibility.example.json`. Refusals (counting cars, identifying people) are
a product requirement and are checked before anything else.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.schemas.watches import (
    CreateWatchRequest,
    FeasibilityDto,
    PatchWatchRequest,
    WatchDto,
    WatchProofDto,
)
from app.services.memory import ID_RE
from earth import settings as earth_settings

__all__ = [
    "MAX_WATCHES_PER_USER",
    "LimitReached",
    "NotWatchable",
    "create_watch",
    "delete_watch",
    "detach_place",
    "feasibility",
    "get_proof",
    "get_watch",
    "list_watches",
    "update_watch",
]

log = logging.getLogger(__name__)
MAX_WATCHES_PER_USER = 100
#: Below this a 10 m pixel grid has fewer than ~100 pixels to measure with.
SMALL_PLOT_HA = 1.0
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


class LimitReached(Exception):
    """Too many watches for this user."""


class NotWatchable(Exception):
    """The question is one satellites cannot (or we will not) answer."""

    def __init__(self, result: FeasibilityDto) -> None:
        super().__init__(result.title)
        self.result = result


# --- feasibility rules -------------------------------------------------------------------------


@dataclass(frozen=True)
class Rule:
    pattern: re.Pattern[str]
    title: str
    skill_id: str
    category_key: str
    metric: str
    condition: str
    satellites: str
    cadence: str
    confidence: str
    notes: tuple[str, ...]
    tier: str = "free"
    cost: str = "Free"
    partial: bool = False
    #: Measures inside the outline at 10 m, so a small place degrades to the paid rule.
    size_sensitive: bool = False

    def dto(self) -> FeasibilityDto:
        return FeasibilityDto(
            ok=True,
            partial=self.partial,
            title=self.title,
            skill_id=self.skill_id,
            category_key=self.category_key,
            metric=self.metric,
            condition=self.condition,
            satellites=self.satellites,
            cadence=self.cadence,
            tier=self.tier,
            cost=self.cost,
            confidence=self.confidence,
            notes=list(self.notes),
        )


def _rx(*words: str) -> re.Pattern[str]:
    return re.compile(r"\b(?:" + "|".join(words) + r")", re.IGNORECASE)


#: Things smaller than a pixel, or that would mean watching individuals. Never offered.
_REFUSE = _rx(
    r"cars?\b",
    r"vehicles?",
    r"trucks?\b",
    r"licen[cs]e plates?",
    r"number plates?",
    r"people",
    r"persons?\b",
    r"individuals?",
    r"faces?\b",
    r"humans?\b",
    r"pedestrians?",
    r"crowds?",
    r"workers?\b",
    r"(?:my|the|his|her|their) (?:neighbou?rs?|husband|wife|partner|employees?|kids?)",
    r"who (?:is|was|goes|comes|lives)",
    r"identify (?:him|her|them|someone|somebody)",
    r"track(?:ing)? (?:him|her|them|someone|somebody|a person)",
)
_REFUSAL = FeasibilityDto(
    ok=False,
    partial=False,
    title="Not possible with satellites",
    category_key="society",
    confidence="Low",
    notes=[
        "Free satellites see 10 m pixels — a car or a person is smaller than one pixel.",
        "Even 30 cm paid imagery cannot identify individuals, and we would not offer it.",
    ],
    alternative="Watch for new buildings, roads or cleared land at this place instead",
)
_UNKNOWN = FeasibilityDto(
    ok=False,
    partial=False,
    title="Not sure satellites can answer this",
    category_key="",
    confidence="Low",
    notes=[
        "We could not match this to something satellites measure: crops, dryness, water, "
        "floods, fire, forest or land change.",
    ],
    alternative="Try naming what should change, e.g. “tell me if the field gets dry”",
)

_SMALL_PLOT = Rule(
    pattern=_rx(r"small", r"backyard", r"back yard", r"garden", r"tiny"),
    title="Crop stress on a small plot",
    skill_id="small-field-stress-3-m",
    category_key="agriculture",
    metric="Stressed area",
    condition="Stress on more than 10% of plot",
    satellites="PlanetScope 3 m",
    cadence="Daily",
    confidence="Medium",
    tier="paid",
    cost="$1.80 / km²",
    partial=True,
    notes=(
        "Your plot is small for free 10 m data. We can watch it with free Sentinel-2 at low "
        "confidence, or with paid 3 m imagery.",
    ),
)

#: First match wins, so more specific topics come first.
RULES: tuple[Rule, ...] = (
    Rule(
        pattern=_rx(r"fires?\b", r"wildfires?", r"burn", r"hotspots?"),
        title="Fire near my places",
        skill_id="active-fire-map",
        category_key="disasters",
        metric="Hotspots within 10 km",
        condition="Any VIIRS hotspot within 10 km",
        satellites="VIIRS / FIRMS",
        cadence="Every ~12 hours",
        confidence="High",
        notes=(
            "Small fires under ~1,000 m² may not be detected.",
            "Alerts arrive 3–5 hours after the pass.",
        ),
    ),
    Rule(
        pattern=_rx(
            r"(?:fish ?)?ponds?\b",
            r"water ?level",
            r"fill(?:ed|ing)? in\b",
            r"reclaim",
            r"(?:losing|lost|less) water",
        ),
        title="Ponds filled in or drying out",
        skill_id="pond-filling-check",
        category_key="water",
        metric="Open-water area",
        condition="Pond area without open water above 0.5 ha",
        satellites="Sentinel-2",
        cadence="Every Sentinel-2 pass (~5 days)",
        confidence="Medium",
        notes=(
            "Cloudy passes are skipped; in a wet week you may wait 10+ days for an update.",
            "Seasonal draining for harvest looks like filling at first; it refills within months.",
        ),
    ),
    Rule(
        pattern=_rx(r"flood", r"inundat", r"submerge", r"under water"),
        title="Flooding on my place",
        skill_id="flood-extent",
        category_key="disasters",
        metric="Flooded area",
        condition="New open water above 1 ha",
        satellites="Sentinel-1",
        cadence="Every 6 days",
        confidence="Medium",
        notes=(
            "Radar passes every 6 days, so a short flood can be missed.",
            "Wet soil after heavy rain can look like shallow water.",
        ),
    ),
    Rule(
        pattern=_rx(
            r"forest", r"deforest", r"logging", r"clear(?:ed|ing)? ", r"trees? (?:cut|felled)"
        ),
        title="New forest clearing",
        skill_id="deforestation-alerts",
        category_key="forests",
        metric="New clearing",
        condition="Clearing above 0.5 ha",
        satellites="Sentinel-1 · Sentinel-2",
        cadence="Every 6 days",
        confidence="High",
        notes=("Selective logging of single trees is below 10 m and usually not seen.",),
    ),
    Rule(
        pattern=_rx(r"algae", r"algal", r"bloom", r"red tide", r"chlorophyll"),
        title="Algae bloom near intake",
        skill_id="algae-red-tide-alert",
        category_key="water",
        metric="Chlorophyll-a",
        condition="Bloom within 5 km",
        satellites="Sentinel-3 OLCI",
        cadence="Daily",
        confidence="Low",
        notes=("300 m pixels — fine near open water, unreliable within ~600 m of the shore.",),
    ),
    _SMALL_PLOT,
    Rule(
        pattern=_rx(r"dry", r"drought", r"moisture", r"irrigat", r"water stress"),
        title="Dry patches on my field",
        skill_id="dry-patch-finder",
        category_key="agriculture",
        metric="Dry area",
        condition="Dry area larger than 5 ha",
        satellites="Sentinel-2 · Landsat 9",
        cadence="Every Sentinel-2 pass (~5 days)",
        confidence="Medium",
        size_sensitive=True,
        notes=(
            "Cloudy passes are skipped; in a wet week you may wait 10+ days for an update.",
            "Areas under ~0.3 ha are below what 10 m pixels can size reliably.",
        ),
    ),
    Rule(
        pattern=_rx(r"crops?\b", r"ndvi", r"health", r"vegetation", r"green"),
        title="Crop health on my field",
        skill_id="weekly-crop-health",
        category_key="agriculture",
        metric="NDVI",
        condition="NDVI drops more than 0.1 between passes",
        satellites="Sentinel-2",
        cadence="Every Sentinel-2 pass (~5 days)",
        confidence="Medium",
        size_sensitive=True,
        notes=("Optical satellites cannot see through cloud; cloudy passes are skipped.",),
    ),
    Rule(
        pattern=_rx(r"buil(?:t|ding)", r"construct", r"roads?\b", r"land[- ]use", r"urban"),
        title="New buildings or land change",
        skill_id="land-use-change",
        category_key="urban",
        metric="Changed area",
        condition="New built-up or cleared land above 0.1 ha",
        satellites="Sentinel-2",
        cadence="Every Sentinel-2 pass (~5 days)",
        confidence="Medium",
        notes=("Pixels are 10 m; changes smaller than ~3 pixels can be missed.",),
    ),
)
_BY_SKILL = {r.skill_id: r for r in RULES}


def _small_plot(area_ha: float) -> FeasibilityDto:
    dto = _SMALL_PLOT.dto()
    monthly = 1.80 * (area_ha / 100) * 30  # $/km² per image, daily images, ~30 per month
    dto.cost = f"$1.80 / km² · ~${monthly:.2f} / month"
    dto.notes = [f"This place is {area_ha:.2g} ha. " + _SMALL_PLOT.notes[0]]
    return dto


def feasibility(text: str, area_ha: float | None = None) -> FeasibilityDto:
    """Classify a question. `area_ha` is the saved place's area, when one is given."""
    if _REFUSE.search(text):
        return _REFUSAL.model_copy(deep=True)
    rule = next((r for r in RULES if r.pattern.search(text)), None)
    if rule is None:
        return _UNKNOWN.model_copy(deep=True)
    if rule.size_sensitive and area_ha is not None and area_ha < SMALL_PLOT_HA:
        return _small_plot(area_ha)
    if rule is _SMALL_PLOT and area_ha is not None:
        return _small_plot(area_ha)
    return rule.dto()


# --- storage -----------------------------------------------------------------------------------


def _path(user_id: str) -> Path:
    if not ID_RE.fullmatch(user_id):
        raise ValueError(f"invalid user_id: {user_id!r}")
    return earth_settings.data_dir() / "watches" / f"{user_id}.json"


def _lock(path: Path) -> threading.Lock:
    with _guard:
        return _locks.setdefault(str(path), threading.Lock())


def _load(path: Path) -> list[dict]:
    """Callers must hold `_lock(path)`. A corrupt file is moved aside and treated as empty."""
    try:
        text = path.read_text(encoding="utf-8")
    except (FileNotFoundError, NotADirectoryError):
        return []
    try:
        rows = json.loads(text)
        if not isinstance(rows, list):
            raise ValueError("watches file is not a list")
        return rows
    except ValueError:
        log.warning("corrupt watches file %s: moved to .corrupt, starting empty", path)
        os.replace(path, path.with_name(path.name + ".corrupt"))
        return []


def _save(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=1)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _dto(row: dict) -> WatchDto:
    return WatchDto.model_validate({k: v for k, v in row.items() if k != "proof"})


def _event(text: str, level: str = "info") -> dict:
    return {"at": _now(), "text": text, "level": level}


def list_watches(user_id: str) -> list[WatchDto]:
    """Newest first."""
    path = _path(user_id)
    with _lock(path):
        rows = _load(path)
    rows.reverse()  # ties (same second): later insertion first
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    return [_dto(r) for r in rows]


def get_watch(user_id: str, watch_id: str) -> WatchDto | None:
    if not ID_RE.fullmatch(watch_id):
        return None
    path = _path(user_id)
    with _lock(path):
        rows = _load(path)
    row = next((r for r in rows if r["id"] == watch_id), None)
    return None if row is None else _dto(row)


def create_watch(user_id: str, req: CreateWatchRequest, area_ha: float | None = None) -> WatchDto:
    """Raises `NotWatchable` for a refused question, `LimitReached` past the per-user cap.
    The caller checks that `req.place_id` exists and passes its `area_ha`."""
    check = feasibility(req.question, area_ha)
    if not check.ok and check.title == _REFUSAL.title:
        raise NotWatchable(check)
    rule = _BY_SKILL.get(req.skill_id)
    spec = rule.dto() if rule is not None and not check.partial else check
    path = _path(user_id)
    with _lock(path):
        rows = _load(path)
        if len(rows) >= MAX_WATCHES_PER_USER:
            raise LimitReached(f"At most {MAX_WATCHES_PER_USER} watches per user.")
        now = _now()
        row = {
            "id": f"w_{uuid.uuid4().hex[:12]}",
            "name": req.name,
            "category_key": req.category_key or spec.category_key,
            "place_id": req.place_id,
            "skill_id": req.skill_id or spec.skill_id,
            "question": req.question,
            "condition": req.condition or spec.condition,
            "metric": spec.metric,
            "confidence": spec.confidence,
            "channels": req.channels,
            "cadence": req.cadence or spec.cadence.replace("—", ""),
            "tier": spec.tier,
            "satellites": spec.satellites.replace("—", ""),
            "enabled": True,
            "events": [_event("Watch created. No passes measured yet.")],
            "proof": {"scenes": [], "hash": ""},
            "created_at": now,
            "updated_at": now,
        }
        rows.append(row)
        _save(path, rows)
    return _dto(row)


def update_watch(user_id: str, watch_id: str, req: PatchWatchRequest) -> WatchDto | None:
    if not ID_RE.fullmatch(watch_id):
        return None
    path = _path(user_id)
    with _lock(path):
        rows = _load(path)
        row = next((r for r in rows if r["id"] == watch_id), None)
        if row is None:
            return None
        changes = req.model_dump(exclude_unset=True)
        if "enabled" in changes and changes["enabled"] != row["enabled"]:
            row["events"].insert(0, _event("Resumed." if changes["enabled"] else "Paused."))
            if not changes["enabled"]:
                row["next_run_at"] = None
        row.update(changes)
        row["updated_at"] = _now()
        _save(path, rows)
    return _dto(row)


def delete_watch(user_id: str, watch_id: str) -> bool:
    if not ID_RE.fullmatch(watch_id):
        return False
    path = _path(user_id)
    with _lock(path):
        rows = _load(path)
        kept = [r for r in rows if r["id"] != watch_id]
        if len(kept) == len(rows):
            return False
        _save(path, kept)
    return True


def get_proof(user_id: str, watch_id: str) -> WatchProofDto | None:
    if not ID_RE.fullmatch(watch_id):
        return None
    path = _path(user_id)
    with _lock(path):
        rows = _load(path)
    row = next((r for r in rows if r["id"] == watch_id), None)
    if row is None:
        return None
    return WatchProofDto.model_validate(row.get("proof") or {})


def detach_place(user_id: str, place_id: str) -> int:
    """Place deleted: its watches become general watches (`place_id: null`), not deleted."""
    path = _path(user_id)
    with _lock(path):
        rows = _load(path)
        hit = [r for r in rows if r.get("place_id") == place_id]
        if not hit:
            return 0
        for r in hit:
            r["place_id"] = None
            r["events"].insert(0, _event("Place deleted; this is now a general watch."))
            r["updated_at"] = _now()
        _save(path, rows)
    return len(hit)
