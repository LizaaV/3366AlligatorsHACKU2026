"""Build the final `Answer` (docs/API.md section 5) from the run's evidence. Pure code.

- `build_answer`: a place answer from a `finish` call that already passed validation, the
  code scoring (`scoring.score`) and the run record (blocks, steps and provenance as stored).
  The cause is kept only when scoring allows it; otherwise the answer is measure-only.
- `build_template_answer`: a measure-only answer built from the findings and evidence so far,
  for runs that hit a cap or keep failing validation. Every number in it is a reading.
- `general_answer`: an explanation-only answer (no data read, kind "general").

Pass a fresh record (`runs.get_run`) so `blocks`, `steps` and `provenance` include everything
already streamed. Stream `blocks_to_stream(answer, record)` as `block_ready` before `answer`.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

import earth
from app.schemas.answer import (
    Answer,
    CardRef,
    Confidence,
    Method,
    ProofScene,
    RouteOption,
    SkillRef,
    StatItem,
)
from app.schemas.runs import RunRecord
from app.services.agent.scoring import (
    Reading,
    ScoreResult,
    fmt_num,
    hypotheses_block,
    observed_readings,
)
from app.services.agent.state import AgentState
from earth.blocks import Block
from knowledge import EventCard, KnowledgeBase, load_knowledge, parse_card

__all__ = [
    "CATEGORY_COLORS",
    "DEFAULT_COLOR",
    "TEMPLATE_REASONS",
    "FinishArgs",
    "answer_hash",
    "blocks_to_stream",
    "build_answer",
    "build_method",
    "build_template_answer",
    "general_answer",
    "proof_from",
    "route_from",
]

#: Eyebrow colour per card category (frontend palette).
CATEGORY_COLORS: dict[str, str] = {
    "agriculture": "#ffcf25",
    "water": "#14c6cb",
    "forests": "#00ca8e",
    "disasters": "#e62b1e",
    "urban": "#7b42bc",
    "oceans": "#1868f2",
    "air": "#fbeabf",
    "finance": "#2b89ff",
    "society": "#911ced",
}
DEFAULT_COLOR = "#3b82f6"

MAX_CAVEATS = 4
MAX_FOLLOWUPS = 3
MAX_STATS = 4
MAX_PROOF = 8
HYPOTHESES_BLOCK_ID = "hypotheses"

TemplateReason = Literal["turns", "code_runs", "time", "finish_rejected", "error", "budget"]
#: Why a template answer was used, in plain words (never echo free text: no numbers, no memory).
TEMPLATE_REASONS: dict[str, str] = {
    "turns": "The run used all its reasoning turns before it could finish.",
    "code_runs": "The run used all its analysis runs before it could finish.",
    "time": "The run reached its time limit before it could finish.",
    "finish_rejected": "The written answer kept failing the automatic checks, so only the "
    "measurements are shown.",
    "error": "The run stopped early because of an error.",
    "budget": "The daily budget for analyses ran out during this run.",
}
_GENERIC_REASON = "The run stopped before it could finish."

#: Plain labels and units for knowledge measures (template answers).
MEASURE_LABELS: dict[str, tuple[str, str]] = {
    "greenness": ("Greenness", ""),
    "moisture": ("Moisture", ""),
    "water": ("Water index", ""),
    "bare": ("Bare ground index", ""),
    "burn": ("Burn index", ""),
    "roughness": ("Radar backscatter", " dB"),
    "slope_deg": ("Slope", "°"),
    "elevation_m": ("Elevation", " m"),
    "rain_mm": ("Rain", " mm"),
    "heat": ("Surface heat", ""),
    "fire": ("Fire detections", ""),
}

_SKILLS_DIR = Path(__file__).resolve().parents[3] / "skills"
_SKILL_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_SUMMARY_SCENE = re.compile(r"^\d+\s+scenes?$")
_FAMILY = re.compile(r"^(Sentinel-\d|Landsat[ -]?\d)", re.IGNORECASE)


# --- finish arguments ---------------------------------------------------------------------------


class FinishStat(BaseModel):
    """One headline number from `finish`."""

    model_config = ConfigDict(extra="ignore")

    label: str
    value: str

    @field_validator("value", mode="before")
    @classmethod
    def _to_text(cls, v: Any) -> Any:
        return str(v) if isinstance(v, int | float) and not isinstance(v, bool) else v


class FinishArgs(BaseModel):
    """The `finish` tool input, parsed leniently (the tool schema is strict upstream)."""

    model_config = ConfigDict(extra="ignore")

    title: str = ""
    sentence: str = ""
    cause_card_id: str | None = None
    cause: str | None = None
    todo: str | None = None
    stats: list[FinishStat] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    primary_block_id: str | None = None
    followups: list[str] = Field(default_factory=list)
    measure_only: bool = False


def _finish(args: FinishArgs | BaseModel | Mapping[str, Any]) -> FinishArgs:
    if isinstance(args, FinishArgs):
        return args
    if isinstance(args, BaseModel):
        args = args.model_dump()
    return FinishArgs.model_validate(dict(args))


# --- text helpers -------------------------------------------------------------------------------


def _clean(text: str | None) -> str:
    return " ".join((text or "").split())


def _key(text: str) -> str:
    return _clean(text).casefold().rstrip(".")


def _dedupe(texts: Iterable[str | None], limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for t in texts:
        text = _clean(t)
        if text and _key(text) not in seen:
            seen.add(_key(text))
            out.append(text)
    return out[:limit]


# --- provenance: route and proof ----------------------------------------------------------------


def _provenance(record: RunRecord) -> list[earth.Provenance]:
    """The run's provenance (record list + every step's), deduplicated, in order."""
    seen: set[tuple[str, str, str]] = set()
    out: list[earth.Provenance] = []
    for p in [*record.provenance, *(s.provenance for s in record.steps if s.provenance)]:
        key = (p.provider, p.scene, p.date.isoformat())
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def _is_scene(p: earth.Provenance) -> bool:
    return bool(p.scene.strip()) and not _SUMMARY_SCENE.match(p.scene.strip())


def _family(satellite: str) -> str:
    m = _FAMILY.match(satellite.strip())
    return m.group(1) if m else satellite.strip()


def proof_from(provenance: Sequence[earth.Provenance]) -> list[ProofScene]:
    """Every individual scene read by the run, oldest first (series summaries left out)."""
    scenes = sorted((p for p in provenance if _is_scene(p)), key=lambda p: (p.date, p.scene))
    if len(scenes) > MAX_PROOF:
        scenes = scenes[: MAX_PROOF // 2] + scenes[-MAX_PROOF // 2 :]
    return [
        ProofScene(
            id=p.scene,
            date=p.date.isoformat(),
            sat=p.satellite,
            cloud=round(p.cloud_over_area * 100, 1),
            used=True,
        )
        for p in scenes
    ]


def route_from(provenance: Sequence[earth.Provenance]) -> list[RouteOption]:
    """Satellites used: the one most measurements came from is `chosen`, others `support`."""
    counts = Counter(_family(p.satellite) for p in provenance if p.satellite.strip())
    if not counts:
        return []
    chosen = counts.most_common(1)[0][0]
    route = [
        RouteOption(
            sat=sat,
            status="chosen" if sat == chosen else "support",
            why="Most measurements came from it."
            if sat == chosen
            else "Used for supporting measurements.",
        )
        for sat in counts
    ]
    if "Sentinel-1" not in counts and any(s.startswith(("Sentinel-2", "Landsat")) for s in counts):
        route.append(
            RouteOption(sat="Sentinel-1", status="skipped", why="Radar was not used in this run.")
        )
    return route


# --- blocks -------------------------------------------------------------------------------------


def _free_id(taken: set[str], base: str) -> str:
    if base not in taken:
        return base
    n = 2
    while f"{base}_{n}" in taken:
        n += 1
    return f"{base}_{n}"


def _with_primary(blocks: list[Block], wanted: str | None) -> list[Block]:
    """Exactly one primary block: `wanted` if present, else the first marked one, else the
    first block that is not a table or a limits note, else the first block."""
    if not blocks:
        return []
    ids = [b.id for b in blocks]
    pick = wanted if wanted in ids else None
    pick = pick or next((b.id for b in blocks if b.primary), None)
    pick = pick or next((b.id for b in blocks if b.type not in ("hypotheses", "limits")), None)
    pick = pick or ids[0]
    out: list[Block] = []
    seen = False
    for b in blocks:
        primary = b.id == pick and not seen
        seen = seen or primary
        out.append(b if b.primary == primary else b.model_copy(update={"primary": primary}))
    return out


def _answer_blocks(
    script_blocks: Sequence[Block], score: ScoreResult | None, primary: str | None
) -> list[Block]:
    """Script blocks plus the code `hypotheses` block, which takes the place (and id) of a
    script-made hypotheses table so only the code-scored one is shown."""
    blocks = list(script_blocks)
    if score is not None and score.cards:
        at = next((i for i, b in enumerate(blocks) if b.type == "hypotheses"), None)
        if at is None:
            hyp = hypotheses_block(score, id=_free_id({b.id for b in blocks}, HYPOTHESES_BLOCK_ID))
            blocks.append(hyp)
        else:
            blocks[at] = hypotheses_block(score, id=blocks[at].id)
            blocks = [b for i, b in enumerate(blocks) if i == at or b.type != "hypotheses"]
    return _with_primary(blocks, primary)


def blocks_to_stream(answer: Answer, record: RunRecord) -> list[Block]:
    """Answer blocks not yet streamed as `block_ready` (new, or changed apart from `primary`)."""
    streamed = {b.id: b.model_copy(update={"primary": False}) for b in record.blocks}
    return [
        b for b in answer.blocks if streamed.get(b.id) != b.model_copy(update={"primary": False})
    ]


# --- method and hash ----------------------------------------------------------------------------


def _skill_version(skill_id: str) -> int:
    """`version` from `skills/<id>/SKILL.md` front matter; 1 when there is none."""
    if not _SKILL_ID.match(skill_id):
        return 1
    try:
        header, _ = parse_card(_SKILLS_DIR / skill_id / "SKILL.md")
        version = header.get("version", 1)
    except (OSError, ValueError):
        return 1
    return version if isinstance(version, int) and version >= 1 else 1


def _skill_run(state: AgentState) -> str | None:
    """The skill behind the answer: the last skill run that worked, else the last one."""
    runs = [s for s in state.scripts if s.kind == "skill" and s.skill_id]
    ok = [s for s in runs if s.ok]
    pick = (ok or runs)[-1] if runs else None
    return pick.skill_id if pick else None


def build_method(
    state: AgentState, kb: KnowledgeBase, record: RunRecord, *, model: str | None
) -> Method:
    """Cards registered and read (pinned to version and status), the skill, the script."""
    cards: list[CardRef] = []
    for cid in dict.fromkeys([*state.hypotheses, *state.cards_read]):
        try:
            card = kb.get(cid)
        except KeyError:
            continue
        cards.append(CardRef(id=card.id, version=card.version, status=card.status))
    skill_id = _skill_run(state)
    ok = [s for s in state.scripts if s.ok]
    last = (ok or state.scripts)[-1] if state.scripts else None
    return Method(
        cards=cards,
        skill=SkillRef(id=skill_id, version=_skill_version(skill_id)) if skill_id else None,
        code_ref=f"run:{record.run_id}#script{last.index}" if last else None,
        model=model,
    )


def answer_hash(method: Method, scenes: Iterable[str]) -> str:
    """Reproducibility hash of the method and the scene ids (same recipe as the preset)."""
    payload = json.dumps(
        {"method": method.model_dump(), "scenes": sorted(set(scenes))}, sort_keys=True
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


# --- shared pieces ------------------------------------------------------------------------------


def _has_place(state: AgentState, record: RunRecord) -> bool:
    return record.area is not None or state.place is not None or state.data_read


def _place_name(state: AgentState, record: RunRecord) -> str:
    name = (state.place.name if state.place else None) or (
        record.area.name if record.area else None
    )
    return _clean(name) or "Your area"


def _color(card: EventCard | None) -> str:
    return CATEGORY_COLORS.get(card.category, DEFAULT_COLOR) if card else DEFAULT_COLOR


def _stats(stats: Iterable[FinishStat]) -> list[StatItem]:
    out = [StatItem(l=_clean(s.label), v=_clean(s.value)) for s in stats]
    return [s for s in out if s.l and s.v][:MAX_STATS]


#: A pass counts as clear when at most this share of the area is cloud.
CLEAR_CLOUD = 0.2
_MEASURE_PCT: dict[str, int] = {"High": 80, "Medium": 60, "Low": 35}
_LEVEL_ORDER = ("Low", "Medium", "High")


def _clear_passes(
    provenance: Sequence[earth.Provenance],
) -> tuple[int, int, int, str, list[float]]:
    """(clear passes, cloudy passes, passes in clear series summaries, main satellite, cloud
    share of each clear pass)."""
    clear: dict[str, float] = {}
    cloudy: set[str] = set()
    series = 0
    for p in provenance:
        scene = p.scene.strip()
        if not scene:
            continue
        if _SUMMARY_SCENE.match(scene):
            if p.cloud_over_area <= CLEAR_CLOUD:
                series = max(series, int(scene.split()[0]))
            continue
        if p.cloud_over_area <= CLEAR_CLOUD:
            clear[scene] = max(clear.get(scene, 0.0), p.cloud_over_area)
        else:
            cloudy.add(scene)
    cloudy -= set(clear)
    families = Counter(_family(p.satellite) for p in provenance if p.satellite.strip())
    sat = families.most_common(1)[0][0] if families else "satellite"
    return len(clear), len(cloudy), series, sat, list(clear.values())


def _cloud_range(clouds: Sequence[float]) -> str:
    lo, hi = (round(100 * min(clouds)), round(100 * max(clouds)))
    return f"{lo}% cloud" if lo == hi else f"{lo} to {hi}% cloud"


def _measure_only_confidence(
    state: AgentState,
    score: ScoreResult | None,
    provenance: Sequence[earth.Provenance] = (),
) -> Confidence:
    """Confidence of a measure-only answer: how solid the measurements are, not a cause.

    High with at least three clear passes (or a clear series), Medium with one or two, Low
    with none; one level down when cloudy passes outnumber clear ones and for each data
    quality warning (few clear pixels, a single image, a small area)."""
    if not state.data_read:
        return Confidence(level="Low", pct=20, note="No satellite data was read for this answer.")
    if not observed_readings(state.findings) and not state.evidence:
        return Confidence(level="Low", pct=20, note="No measurement finished in this run.")
    clear, cloudy, series, sat, clouds = _clear_passes(provenance)
    passes = max(clear, series)
    idx = 2 if passes >= 3 else (1 if passes >= 1 else 0)
    if cloudy > clear and not series:
        idx -= 1
    quality = list(score.quality) if score is not None else []
    idx = max(0, idx - len(quality))
    level = _LEVEL_ORDER[idx]
    if series and series > clear:
        measured = f"Measured on a series of {series} {sat} passes"
    elif clear:
        measured = (
            f"Measured on {clear} clear {sat} pass{'es' if clear != 1 else ''} "
            f"({_cloud_range(clouds)})"
        )
    else:
        measured = "Measured without a clear pass"
    if cloudy:
        measured += f", plus {cloudy} cloudy pass{'es' if cloudy != 1 else ''}"
    note = " ".join([f"{measured}; no cause is named.", *quality[:1]])
    return Confidence(level=level, pct=_MEASURE_PCT[level], note=note)


def _cause_card(f: FinishArgs, score: ScoreResult, kb: KnowledgeBase) -> EventCard | None:
    """The cause card, only when the answer names one and code scoring allows it."""
    cid = (f.cause_card_id or "").strip()
    if f.measure_only or not cid or cid not in kb.events:
        return None
    return kb.events[cid] if score.cause_problem(cid) is None else None


def _cause_text(f: FinishArgs, card: EventCard) -> str:
    text = _clean(f.cause)
    if text:
        return text
    if card.wording and card.wording.use:
        return card.wording.use[0]
    return f"consistent with {card.name.lower()}"


#: Index names in card text -> the plain measure words the answer uses.
_PLAIN_INDEX: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bMNDWI\b|\bNDWI\b"), "the water reading"),
    (re.compile(r"\bNDVI\b"), "greenness"),
    (re.compile(r"\bNDBI\b"), "the bare-ground reading"),
    (re.compile(r"\bNDMI\b"), "the moisture reading"),
    (re.compile(r"\bNBR\b"), "the burn reading"),
    (re.compile(r"\bSentinel-1 VV\b|\bVV\b"), "the radar reading"),
    (re.compile(r"\bSWIR\b"), "short-wave infrared"),
    (re.compile(r"\bNIR\b"), "near infrared"),
)
_CARD_ID_RE = re.compile(r"\b[a-z]+(?:_[a-z]+)+\b")


def plain_words(text: str, kb: KnowledgeBase) -> str:
    """Card text for people: index names in plain words, card ids as card names."""
    for rx, words in _PLAIN_INDEX:
        text = rx.sub(words, text)

    def name(m: re.Match[str]) -> str:
        cid = m.group(0)
        card = kb.events.get(cid) or kb.settings.get(cid)
        return card.name.lower() if card is not None else cid.replace("_", " ")

    return _CARD_ID_RE.sub(name, text)


def _tie_caveat(score: ScoreResult, kb: KnowledgeBase) -> str | None:
    if score.cannot_distinguish is None:
        return None
    a, b = (kb.events[i].name.lower() for i in score.cannot_distinguish)
    text = f"Can't tell between {a} and {b} from this data."
    if not score.settle:
        return text
    return f"{text} What would settle it: {plain_words(score.settle, kb)}"


#: A caveat that already says no cause is named (the code then adds no second one).
_NAMES_NO_CAUSE = re.compile(r"\bcauses?\b|\bno (?:knowledge )?card\b", re.IGNORECASE)


def _unknown_cause_caveat(score: ScoreResult) -> str:
    """Why no cause is named, in the words that match the scoring."""
    supported = sum(c.verdict == "supported" for c in score.cards)
    if score.cannot_distinguish is not None or supported > 1:
        return "More than one cause fits the measurements, so none is named."
    if supported == 1:
        return "No cause is named in this answer; only the measurements are reported."
    return "The cause is unknown: no knowledge card fits the measurements well enough."


# --- answers ------------------------------------------------------------------------------------


def build_answer(
    finish_args: FinishArgs | BaseModel | Mapping[str, Any],
    state: AgentState,
    score: ScoreResult,
    kb: KnowledgeBase,
    record: RunRecord,
    *,
    blocks: Sequence[Block] | None = None,
) -> Answer:
    """The answer for a validated `finish`: text from the model, everything else from code.

    `blocks` overrides `record.blocks` (the script blocks already streamed).
    """
    f = _finish(finish_args)
    card = _cause_card(f, score, kb)
    top = kb.events.get(score.top) if score.top else None
    provenance = _provenance(record)
    proof = proof_from(provenance)
    method = build_method(state, kb, record, model=state.model or record.model)

    system = [_tie_caveat(score, kb)]
    # Why no cause is named: only when the model tried to name one (not for a deliberate
    # measure-only answer or a description) and its own caveats do not already say so.
    if (
        card is None
        and state.data_read
        and score.cannot_distinguish is None
        and not f.measure_only
        and not any(_NAMES_NO_CAUSE.search(c) for c in f.caveats)
    ):
        system.append(_unknown_cause_caveat(score))
    card_lines = list(card.cannot_tell) if card else []
    # Model caveats first, but the card's own limits always get a place among the four.
    caveats = [*f.caveats[:2], *system, *card_lines[:1], *f.caveats[2:], *card_lines[1:]]
    sentence = _clean(f.sentence)
    title = _clean(f.title) or sentence or "What the satellite data shows"
    place = _has_place(state, record)
    return Answer(
        kind="place" if place else "general",
        title=title,
        eyebrow=_place_name(state, record) if place else None,
        color=_color(card or top),
        sentence=sentence or title,
        cause=_cause_text(f, card) if card else None,
        todo=_clean(f.todo) or None,
        stats=_stats(f.stats),
        confidence=(
            score.confidence if card else _measure_only_confidence(state, score, provenance)
        ),
        caveats=_dedupe(caveats, MAX_CAVEATS),
        route=route_from(provenance),
        proof=proof,
        blocks=_answer_blocks(
            record.blocks if blocks is None else blocks, score, f.primary_block_id
        ),
        followups=_dedupe(f.followups, MAX_FOLLOWUPS),
        method=method,
        skill_id=_skill_run(state),
        measure_only=card is None,
        preset=False,
        hash=answer_hash(method, (p.scene for p in provenance if _is_scene(p))),
    )


def _evidence_measures(evidence: Iterable[Any]) -> dict[str, Reading]:
    """Fallback readings from evidence rows ({measure, value, date, ...}), latest last."""
    out: dict[str, Reading] = {}
    for row in evidence:
        if not isinstance(row, Mapping):
            continue
        measure = row.get("measure")
        reading = Reading.parse({"value": row.get("value"), "date": row.get("date")})
        if isinstance(measure, str) and measure in MEASURE_LABELS and reading is not None:
            out[measure] = reading
    return out


def _reading_text(measure: str, r: Reading) -> str | None:
    """Before → after (delta), or the latest value: only numbers present in the reading."""
    _, unit = MEASURE_LABELS[measure]
    if r.before is not None and r.after is not None:
        text = f"{fmt_num(r.before)} → {fmt_num(r.after)}{unit}"
        if r.delta is not None:
            sign = "" if fmt_num(r.delta).startswith("-") else "+"
            text += f" ({sign}{fmt_num(r.delta)})"
        return text
    if r.level is not None:
        return f"{fmt_num(r.level)}{unit}" + (f" on {r.date}" if r.date else "")
    return None


def build_template_answer(
    state: AgentState,
    record: RunRecord,
    reason: TemplateReason | str,
    *,
    score: ScoreResult | None = None,
    kb: KnowledgeBase | None = None,
    blocks: Sequence[Block] | None = None,
) -> Answer:
    """A measure-only answer from the findings and evidence so far (caps, failed checks).

    Never names a cause and never invents a number: every number is a reading, formatted.
    `reason` is a `TEMPLATE_REASONS` key; anything else gets a generic line (never echoed).
    """
    kb = kb or _default_kb()
    readings = {
        m: r for m, r in observed_readings(state.findings).items() if m in MEASURE_LABELS
    } or _evidence_measures(state.evidence)
    parts = [
        (MEASURE_LABELS[m][0], text) for m, r in readings.items() if (text := _reading_text(m, r))
    ]
    if parts:
        listed = "; ".join(f"{label.lower()} {text}" for label, text in parts[:3])
        sentence = f"Measured so far: {listed}."
    else:
        sentence = "The run stopped before any measurement finished, so there is nothing to show."
    why = TEMPLATE_REASONS.get(reason, _GENERIC_REASON)
    caveats = [why, "No cause is named: the possible causes were not checked to the end."]
    if parts:
        caveats.append("Only the measurements that finished are shown.")

    provenance = _provenance(record)
    proof = proof_from(provenance)
    method = build_method(state, kb, record, model=None)
    place = _has_place(state, record)
    return Answer(
        kind="place" if place else "general",
        title="What the satellite data shows so far" if parts else "No answer this time",
        eyebrow=_place_name(state, record) if place else None,
        color=DEFAULT_COLOR,
        sentence=sentence,
        cause=None,
        todo="Ask a narrower question, such as one measure or a shorter period, or try again.",
        stats=[StatItem(l=label, v=text) for label, text in parts[:MAX_STATS]],
        confidence=Confidence(
            level="Low", pct=30 if parts else 15, note=f"{why} No cause is named."
        ),
        caveats=_dedupe(caveats, MAX_CAVEATS),
        route=route_from(provenance),
        proof=proof,
        blocks=_answer_blocks(record.blocks if blocks is None else blocks, score, None),
        followups=[],
        method=method,
        skill_id=_skill_run(state),
        measure_only=True,
        preset=False,
        hash=answer_hash(method, (p.scene for p in provenance if _is_scene(p))),
    )


def _skills_for(card_ids: Iterable[str]) -> list[str]:
    """Skill folders named after a card (pond_filling -> pond-filling-check)."""
    try:
        names = sorted(p.name for p in _SKILLS_DIR.iterdir() if p.is_dir())
    except OSError:
        return []
    prefixes = [cid.replace("_", "-") for cid in card_ids]
    return [n for n in names if _SKILL_ID.match(n) and any(n.startswith(p) for p in prefixes)]


def general_answer(
    finish_args: FinishArgs | BaseModel | Mapping[str, Any],
    state: AgentState,
    kb: KnowledgeBase,
    record: RunRecord,
) -> Answer:
    """An explanation-only answer (no data read): no scoring, no cause, kind "general"."""
    f = _finish(finish_args)
    cards = [kb.events[c] for c in dict.fromkeys(state.cards_read) if c in kb.events]
    statuses = {c.status for c in cards}
    if cards and statuses == {"reviewed"}:
        level, pct = "High", 85
    elif cards and "draft" not in statuses:
        level, pct = "Medium", 65
    else:
        level, pct = "Low", 40
    note = "Explained from the knowledge cards; no satellite data was read for this answer."
    if "draft" in statuses:
        note += " Some cards are drafts, not yet tested on known cases."
    method = build_method(state, kb, record, model=state.model or record.model)
    sentence = _clean(f.sentence)
    title = _clean(f.title) or sentence or "About your question"
    return Answer(
        kind="general",
        title=title,
        eyebrow=None,
        color=_color(cards[0] if cards else None),
        sentence=sentence or title,
        cause=None,
        todo=_clean(f.todo) or None,
        stats=_stats(f.stats),
        confidence=Confidence(level=level, pct=pct, note=note),
        caveats=_dedupe(f.caveats, MAX_CAVEATS),
        blocks=_with_primary(list(record.blocks), f.primary_block_id),
        followups=_dedupe(f.followups, MAX_FOLLOWUPS),
        method=method,
        suggested_skills=_skills_for(c.id for c in cards),
        measure_only=False,
        preset=False,
        hash=answer_hash(method, ()),
    )


@lru_cache(maxsize=1)
def _default_kb() -> KnowledgeBase:
    return load_knowledge()
