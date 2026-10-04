"""Watch records and the feasibility check (issue #40).

Storage mirrors `places.py`: one JSON file per user, `<EARTH_DATA_DIR>/watches/<user_id>.json`.
Every user is offered two working demo triggers once (`_seed_once`), on the demo and example
places, so the Triggers page is never empty and "check now" can be shown from any browser.

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
    "CheckError",
    "check_watch",
    "parse_condition",
    "watch_message",
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
    data = {k: v for k, v in row.items() if k not in ("proof", "last_check")}
    return WatchDto.model_validate({**data, "message": watch_message(row)})


def _event(text: str, level: str = "info") -> dict:
    return {"at": _now(), "text": text, "level": level}


# Demo triggers: (seed key, place, skill, name, question, condition). Each runs a real skill on
# a seeded place, so "check now" gives a real reading.
_DEMO_TRIGGERS: list[tuple[str, str, str, str, str, str]] = [
    (
        "demo_hhw_ponds",
        "pl_hhw",
        "pond-filling-check",
        "Hoo Hok Wai ponds · filling",
        "Tell me if the fish ponds are filled in",
        "Open water drops below normal",
    ),
    (
        "demo_hyde_park_green",
        "pl_example_hyde_park",
        "greenness-check",
        "Hyde Park · greenness",
        "Tell me if Hyde Park gets less green than usual",
        "Greenness drops below normal",
    ),
]


def _seed_marker(path: Path) -> Path:
    return path.with_name(path.stem + ".seeded")


def _seed_once(user_id: str, path: Path, rows: list[dict]) -> list[dict]:
    """Offer each demo trigger once. Skipped when its place is gone or the user already has a
    trigger with the same place and skill; a deleted demo trigger never comes back (the
    marker lists what was offered). Callers must hold `_lock(path)`."""
    from app.services import places  # places imports this module

    marker = _seed_marker(path)
    offered = set(marker.read_text().split()) if marker.exists() else set()
    todo = [d for d in _DEMO_TRIGGERS if d[0] not in offered]
    if not todo:
        return rows
    have = {(r.get("place_id"), r.get("skill_id")) for r in rows}
    added = []
    for _key, place_id, skill_id, name, question, condition in todo:
        place = None if (place_id, skill_id) in have else places.get_place(user_id, place_id)
        if place is None:
            continue
        req = CreateWatchRequest(
            name=name,
            category_key=place.category_key,  # filed like its place
            place_id=place_id,
            skill_id=skill_id,
            question=question,
            condition=condition,
        )
        added.append(_new_row(req, feasibility(question)))
    if added:
        rows = [*rows, *added]
        _save(path, rows)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("\n".join(sorted(offered | {d[0] for d in todo})) + "\n")
    return rows


def list_watches(user_id: str) -> list[WatchDto]:
    """Newest first."""
    path = _path(user_id)
    with _lock(path):
        rows = _seed_once(user_id, path, _load(path))
    rows.reverse()  # ties (same second): later insertion first
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    return [_dto(r) for r in rows]


def get_watch(user_id: str, watch_id: str) -> WatchDto | None:
    if not ID_RE.fullmatch(watch_id):
        return None
    path = _path(user_id)
    with _lock(path):
        rows = _seed_once(user_id, path, _load(path))
    row = next((r for r in rows if r["id"] == watch_id), None)
    return None if row is None else _dto(row)


def create_watch(user_id: str, req: CreateWatchRequest, area_ha: float | None = None) -> WatchDto:
    """Raises `NotWatchable` for a refused question, `LimitReached` past the per-user cap.
    The caller checks that `req.place_id` exists and passes its `area_ha`."""
    check = feasibility(req.question, area_ha)
    if not check.ok and check.title == _REFUSAL.title:
        raise NotWatchable(check)
    path = _path(user_id)
    with _lock(path):
        rows = _load(path)
        if len(rows) >= MAX_WATCHES_PER_USER:
            raise LimitReached(f"At most {MAX_WATCHES_PER_USER} watches per user.")
        row = _new_row(req, check)
        rows.append(row)
        _save(path, rows)
    return _dto(row)


def _new_row(req: CreateWatchRequest, check: FeasibilityDto) -> dict:
    """A new watch record from the request and its feasibility check."""
    rule = _BY_SKILL.get(req.skill_id)
    spec = rule.dto() if rule is not None and not check.partial else check
    now = _now()
    return {
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


# --- check now (build-plan A5) -----------------------------------------------------------------
#
# Runs a watch once, without the LLM: the watch's skill (if it is in the skill registry) in the
# sandbox, plus a direct `earth.series` of the watched measure for the normal band and history.
# Status comes from the watch's condition (see `parse_condition`).

#: Upper bound for one check (the request is synchronous): skill run + series read.
CHECK_TIMEOUT_S = 150
SKILL_TIMEOUT_S = 140
SERIES_TIMEOUT_S = 90
#: Noise margin around the normal band before a reading counts as clearly outside it.
BAND_PAD = 0.05

#: Words in a watch's skill id / metric / question → the earth measure it watches. First wins.
_MEASURE_WORDS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("water", ("pond", "flood", "water", "inundat", "wetland")),
    ("moisture", ("dry", "moisture", "drought", "irrigat")),
    ("heat", ("heat", "temperature")),
    ("greenness", ("green", "crop", "ndvi", "tree", "forest", "vegetation", "health", "stress")),
    ("bare", ("build", "built", "land-use", "land use", "construct", "urban", "bare", "clear")),
)
#: Direction that is bad news for each measure, when the condition does not say.
_BAD_DIRECTION = {"water": "below", "greenness": "below", "moisture": "below", "bare": "above"}
_BAD_DIRECTION["heat"] = "above"
_LABEL = {
    "water": "open water",
    "greenness": "greenness",
    "moisture": "moisture",
    "bare": "bare ground",
    "heat": "surface heat",
}
_INDEX = {
    "water": "water index",
    "greenness": "greenness (NDVI)",
    "moisture": "moisture index",
    "bare": "bare-ground index",
    "heat": "surface heat",
}


class CheckError(Exception):
    """A check that cannot run. `status` is the HTTP status the route returns."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class Condition:
    """What a watch's condition text asks for.

    kind "band": alert when the reading leaves the normal band in `direction`.
    kind "drop": alert when the reading moves more than `threshold` in `direction` between
    the last two passes. kind "area": alert when the changed area exceeds `threshold`
    (`unit` "ha" or "%"), when the skill reports a changed area; else falls back to "band".
    """

    kind: str
    direction: str
    threshold: float | None = None
    unit: str = ""


_NUM = r"(\d+(?:\.\d+)?)"
_DROP_RX = re.compile(
    r"(drops?|falls?|rises?|increases?|decreases?|changes?)\s+(?:by\s+)?(?:more than|over|above)\s+"
    + _NUM
    + r"(?!\s*(?:ha|%))",
    re.IGNORECASE,
)
_AREA_RX = re.compile(r"(?:above|more than|larger than|over|exceeds?)\s+" + _NUM + r"\s*(ha|%)")


def parse_condition(text: str, measure: str) -> Condition:
    """Parse the condition texts the feasibility rules write (and simple user variants)."""
    t = (text or "").lower()
    bad = _BAD_DIRECTION.get(measure, "below")
    if re.search(r"\b(above|higher|rises?|increases?|more than usual|hotter)\b", t) and not (
        _AREA_RX.search(t)
    ):
        direction = "above"
    elif re.search(r"\b(below|lower|drops?|falls?|decreases?|loses?|less)\b", t):
        direction = "below"
    else:
        direction = bad
    if m := _DROP_RX.search(t):
        verb = m.group(1)
        d = "above" if verb.startswith(("rise", "increase")) else direction
        if verb.startswith("change"):
            d = "either"
        return Condition("drop", d, float(m.group(2)))
    if m := _AREA_RX.search(t):
        return Condition("area", bad, float(m.group(1)), m.group(2))
    return Condition("band", direction)


#: Watched things that are not an index series (fires, algae): a check cannot measure them yet.
_UNMEASURABLE = ("fire", "hotspot", "algae", "algal", "bloom", "chlorophyll")


def _measure_for(row: dict) -> str | None:
    hay = " ".join(str(row.get(k) or "") for k in ("skill_id", "metric", "question")).lower()
    if any(w in hay for w in _UNMEASURABLE):
        return None
    for measure, words in _MEASURE_WORDS:
        if any(w in hay for w in words):
            return measure
    return None


def _band_status(value: float, lo: float, hi: float, direction: str) -> tuple[str, str]:
    """(status, relation) of a reading against the normal band."""
    below, above = value < lo, value > hi
    relation = (
        "below the usual range"
        if below
        else "above the usual range"
        if above
        else "within the usual range"
    )
    bad = (direction in ("below", "either") and below) or (
        direction in ("above", "either") and above
    )
    if not bad:
        return ("warn" if (below or above) else "ok"), relation
    far = value < lo - BAND_PAD if below else value > hi + BAND_PAD
    return ("alert" if far else "warn"), relation


def _fmt(x: float) -> str:
    return f"{x:.2f}".replace("-0.00", "0.00")


def _day_label(iso: str) -> str:
    try:
        d = datetime.fromisoformat(iso)
    except ValueError:
        return iso
    return f"{d.day} {d:%b %Y}"


def _usual_range(series, value: float) -> tuple[float, float, float]:
    """(lo, hi, mean) usual for the latest pass's season, from EARLIER passes only.

    Same calendar month ±1 in earlier passes (≥3 of them), else every earlier pass; the
    10th–90th percentile. Falls back to the series' own monthly band.
    """
    import statistics

    last = series.points[-1]
    earlier = series.points[:-1]
    near = [
        p.value
        for p in earlier
        if min(abs(p.date.month - last.date.month), 12 - abs(p.date.month - last.date.month)) <= 1
    ]
    vals = near if len(near) >= 3 else [p.value for p in earlier]
    if len(vals) >= 3:
        q = statistics.quantiles(vals, n=10, method="inclusive")
        return q[0], q[-1], statistics.fmean(vals)
    band = {b.month: b for b in series.band}.get(last.date.month)
    return (band.lo, band.hi, band.mean) if band else (value, value, value)


def _skill(skill_id: str):  # -> Skill | None
    from app.services.agent import skills as reg

    if not skill_id or not reg.SKILL_ID_RE.fullmatch(skill_id):
        return None
    try:
        if skill_id not in reg.skill_ids():
            return None
        return reg.get_skill(skill_id)
    except reg.SkillError:
        log.warning("skill %s is in the registry but does not load", skill_id)
        return None


async def _run_skill(skill, place, run_id: str) -> tuple[dict | None, list[dict], str | None]:
    """(findings, evidence, failure note). Never raises for a script failure."""
    from app.services.agent import skills as reg

    try:
        params = reg.prepare_params(skill, {}, area=place.geometry, name=place.name)
    except reg.SkillError as exc:
        return None, [], f"{skill.id} could not run here: {exc}"
    timeout = min(skill.timeout_s or SKILL_TIMEOUT_S, SKILL_TIMEOUT_S)
    outcome = await reg.run_skill_script(skill.id, params, run_id, timeout_s=timeout)
    if not outcome.ok or outcome.result is None:
        msg = outcome.error.message if outcome.error else "no result"
        return None, [], f"{skill.id} failed ({msg}); measured directly instead."
    return outcome.result.findings, outcome.result.evidence, None


def _read_series(place, measure: str):  # -> earth.Series
    import earth

    area = earth.Area.from_geojson(place.geometry)
    return earth.series(area, measure, years=3)


def _changed_area(findings: dict | None) -> float | None:
    if not findings:
        return None
    v = findings.get("changed_ha")
    return float(v) if isinstance(v, int | float) else None


def _proof_from(evidence: list[dict], series) -> dict:
    scenes: dict[str, dict] = {}
    for e in evidence:
        prov = e.get("provenance") or {}
        sid = str(e.get("scene") or prov.get("scene") or "")
        if not sid or sid in scenes or " scenes" in sid:
            continue
        scenes[sid] = {
            "id": sid,
            "date": str(e.get("date") or prov.get("date") or ""),
            "sat": str(prov.get("satellite") or ""),
            "cloud": 0.0,
            "used": True,
            "why": None,
        }
    if not scenes and series is not None:
        for p in series.points[-4:]:
            scenes[p.scene] = {
                "id": p.scene,
                "date": str(p.date),
                "sat": series.provenance.satellite,
                "cloud": 0.0,
                "used": True,
                "why": None,
            }
    ids = sorted(scenes)
    import hashlib

    digest = hashlib.sha256(json.dumps(ids).encode()).hexdigest()[:16] if ids else ""
    return {"scenes": list(scenes.values())[:12], "hash": digest}


async def check_watch(user_id: str, watch_id: str) -> WatchDto:
    """Run the watch now and store the result. Raises `CheckError` (404/409/422/504)."""
    import asyncio

    from app.services import places

    if not ID_RE.fullmatch(watch_id):
        raise CheckError(404, "watch not found")
    path = _path(user_id)
    with _lock(path):
        row = next((r for r in _load(path) if r["id"] == watch_id), None)
    if row is None:
        raise CheckError(404, "watch not found")
    if not row.get("place_id"):
        raise CheckError(409, "This watch has no place to measure; attach a place first.")
    place = await asyncio.to_thread(places.get_place, user_id, row["place_id"])
    if place is None:
        raise CheckError(409, "The watch's place no longer exists.")
    measure = _measure_for(row)
    if measure is None:
        raise CheckError(
            422, f"“{row.get('metric') or row['name']}” cannot be measured by a check yet."
        )

    async def work():
        skill = _skill(row.get("skill_id", ""))
        series_task = asyncio.wait_for(
            asyncio.to_thread(_read_series, place, measure), SERIES_TIMEOUT_S
        )
        if skill is None:
            return None, None, [], None, await series_task
        (findings, evidence, note), series = await asyncio.gather(
            _run_skill(skill, place, f"w_{watch_id}"), series_task
        )
        return skill, findings, evidence, note, series

    import earth

    try:
        skill, findings, evidence, note, series = await asyncio.wait_for(work(), CHECK_TIMEOUT_S)
    except TimeoutError as exc:
        raise CheckError(504, f"The check took longer than {CHECK_TIMEOUT_S} s.") from exc
    except earth.EarthError as exc:
        raise CheckError(422, f"Could not measure this place: {exc.message}") from exc
    if not series.points:
        raise CheckError(422, "No clear satellite pass over this place yet.")

    last = series.points[-1]
    observed = ((findings or {}).get("observed") or {}).get(measure) or {}
    value = observed.get("value")
    value = float(value) if isinstance(value, int | float) else float(last.value)
    after = (findings or {}).get("after") if observed.get("value") is not None else None
    when = after if isinstance(after, str) and after else str(last.date)
    lo, hi, mean = _usual_range(series, value)

    cond = parse_condition(row.get("condition", ""), measure)
    status, relation = _band_status(value, lo, hi, cond.direction)
    met = status == "alert"
    change = ""
    if len(series.points) >= 2:
        prev = series.points[-2]
        move = last.value - prev.value
        change = f"{move:+.2f} since the pass of {_day_label(str(prev.date))}"
    if cond.kind == "drop" and len(series.points) >= 2:
        bad = (
            abs(move)
            if cond.direction == "either"
            else (-move if cond.direction == "below" else move)
        )
        status = "alert" if bad > cond.threshold else "warn" if bad > cond.threshold / 2 else "ok"
        met = bad > cond.threshold
        change += f" (limit {cond.threshold:g})"
    changed = _changed_area(findings)
    if changed is not None:
        before = (findings or {}).get("before")
        since = f" since {_day_label(before)}" if isinstance(before, str) else ""
        change = f"{changed:.1f} ha changed{since}" + (f"; {change}" if change else "")
        if cond.kind == "area":
            amount = changed if cond.unit == "ha" else 100 * changed / max(place.area_ha, 1e-9)
            thr = cond.threshold
            met = amount > thr
            status = "alert" if met else "warn" if amount > thr / 2 else status
            change += f" (limit {thr:g} {cond.unit})"
    change = change or "no earlier pass to compare"

    level = {"ok": "info", "warn": "warn", "alert": "alert"}[status]
    verdict = "Condition met" if met else "Condition not met"
    text = (
        f"Checked the pass of {_day_label(when)}: {_INDEX[measure]} {_fmt(value)} "
        f"(usual {_fmt(lo)} to {_fmt(hi)}, {relation.replace(' the usual range', '')}), "
        f"{change}. {verdict} → {status}."
    )
    if skill is not None and note is None:
        text += f" Skill {skill.id} ran."
    elif note:
        text += f" {note}"

    pts = series.points[-24:]
    months = {b.month: b for b in series.band}
    series_dto = {
        "unit": "index",
        "labels": [str(p.date) for p in pts],
        "current": [round(p.value, 4) for p in pts],
        "band_low": [
            round(months[p.date.month].lo, 4) if p.date.month in months else None for p in pts
        ],
        "band_high": [
            round(months[p.date.month].hi, 4) if p.date.month in months else None for p in pts
        ],
        "mean": [
            round(months[p.date.month].mean, 4) if p.date.month in months else None for p in pts
        ],
    }
    if any(v is None for k in ("band_low", "band_high", "mean") for v in series_dto[k]):
        fill = {"band_low": lo, "band_high": hi, "mean": mean}
        for k, d in fill.items():
            series_dto[k] = [round(d, 4) if v is None else v for v in series_dto[k]]

    check = {
        "measure": measure,
        "value": round(value, 4),
        "lo": round(lo, 4),
        "hi": round(hi, 4),
        "relation": relation,
        "change": change,
        "met": met,
        "date": when,
        "place_name": place.name,
        "status": status,
    }
    with _lock(path):
        rows = _load(path)
        stored = next((r for r in rows if r["id"] == watch_id), None)
        if stored is None:
            raise CheckError(404, "watch not found")
        stored.update(
            value=round(value, 4),
            unit="index",
            baseline=round(mean, 4),
            baseline_label=f"Usual around {_month(when)}: {_fmt(lo)} to {_fmt(hi)}",
            delta=f"{value - mean:+.2f} vs usual",
            status=status,
            last_run_at=_now(),
            series=series_dto,
            last_check=check,
            proof=_proof_from(evidence, series),
            updated_at=_now(),
        )
        stored["events"].insert(0, _event(text, level))
        del stored["events"][50:]
        _save(path, rows)
    return _dto(stored)


def _month(iso: str) -> str:
    try:
        return f"{datetime.fromisoformat(iso):%B}"
    except ValueError:
        return "this month"


def _sent_when(cond: Condition, measure: str) -> str:
    what = _INDEX.get(measure, "the reading")
    if cond.kind == "drop":
        verb = {"below": "falls", "above": "rises", "either": "moves"}[cond.direction]
        return f"{what} {verb} more than {cond.threshold:g} between passes"
    if cond.kind == "area":
        return f"more than {cond.threshold:g} {cond.unit} of the place changes"
    side = "above" if cond.direction == "above" else "below"
    return f"{what} goes {side} its usual range for the season"


def watch_message(row: dict) -> str:
    """The one-line alert the user would receive, built from the last check (or a sample).

    Always carries the numbers: value, usual range, change, pass date, and the verdict.
    """
    measure = _measure_for(row) or ""
    chk = row.get("last_check")
    if isinstance(chk, dict) and chk.get("value") is not None:
        what = _INDEX.get(chk.get("measure", ""), "reading")
        place = chk.get("place_name") or row.get("name", "")
        verdict = "Condition met" if chk.get("met") else "Condition not met"
        tail = " Tap to see the evidence." if chk.get("status") != "ok" else ""
        return (
            f"{place} · {_day_label(str(chk.get('date', '')))}: {what} {_fmt(chk['value'])} "
            f"(usual {_fmt(chk['lo'])} to {_fmt(chk['hi'])}), {chk.get('change') or 'no change'}. "
            f"{verdict}.{tail}"
        )
    cond = parse_condition(row.get("condition", ""), measure)
    what = _INDEX.get(measure, "the reading")
    return (
        f"Sample · {row.get('name', '')} · <pass date>: {what} <value> (usual <low> to <high>), "
        f"<change since the last pass>. Sent when {_sent_when(cond, measure)}."
    )
