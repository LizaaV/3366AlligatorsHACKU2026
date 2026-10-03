"""Code scoring of the registered hypotheses (HANDOFF B3.3-B3.4). The LLM never scores.

Each registered event card's signs are checked against `state.findings["observed"]` (the
FINDINGS CONVENTION: one reading per knowledge measure with `value`, `before`, `after`,
`delta`, `inside_band`, `local`, `persistent`, `sudden`, `date`). A sign is `pass`, `fail` or
`unknown`:

- direction (`down` / `up`, optionally `by_more_than`), `stable`, `above` / `below` a
  threshold, `inside_band` / `outside_band` the normal seasonal range;
- a measured value near the line (within a quarter of `by_more_than`, or within the
  measure's noise of a threshold) is `unknown`, not a hard miss;
- `timing: sudden|gradual` fails when the reading says the change was the other kind,
  `spatial: local|regional` likewise with `local`;
- a sign whose `shape` starts with "stays" is a persistence sign: it fails when the change
  did not last, and a pass needs `persistent: true` (else it is only `unknown`);
- optional signs (planned measures) only ever add weight.

Context measures no script observed (the outline's slope from `earth.describe`) are read
from `state.context_observed`; a script's own reading always wins.

Score = sum of matched weights + 40% of unknown weights - contradicted weights. A card is
`supported` only when that score reaches its `medium_min_weight`, a non-context measure
matched, and no look-alike fits clearly better (`score / possible` more than 15% higher).
When the top two are within 15%, a before-state check the cards name settles it first
(`TIE_RULES`: pond filling needs open water before, vegetation loss keeps some greenness);
otherwise look-alikes are compared on their cards'
`discriminating_measures` (confirmed minus contradicted weight there); if that does not
separate them either, the answer is "can't tell between A and B" (with the card's
`tell_apart_by` as what would settle it). Confidence comes from the top card's thresholds,
capped Low for draft cards and post-hoc hypotheses (Medium for tested cards) and
downgraded one level per data problem (few clean pixels, a single scene, a very small area).
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, Field

import earth
from app.schemas.answer import Confidence
from app.schemas.stream import ExpectationRow
from app.services.agent.state import AgentState
from earth.blocks import HypothesesBlock, HypothesisRow
from knowledge import MEASURES_CONTEXT, EventCard, KnowledgeBase
from knowledge.schema import Sign

__all__ = [
    "CardScore",
    "Reading",
    "ScoreResult",
    "SignCheck",
    "check_sign",
    "data_quality",
    "expected_rows",
    "expected_text",
    "fmt_num",
    "hypotheses_block",
    "observed_readings",
    "observed_text",
    "score",
]

SignState = Literal["pass", "fail", "unknown"]
Verdict = Literal["supported", "contradicted", "unclear", "untested"]
Level = Literal["High", "Medium", "Low"]

#: Share of a sign's weight credited when it could not be checked (HANDOFF B3.4).
UNKNOWN_SHARE = 0.4
#: Top two cards closer than this (relative to the leader's score) cannot be told apart.
TIE_MARGIN = 0.15
#: Below this many clean pixels a measurement is weak (HANDOFF B3.4).
MIN_CLEAN_PX = 50
#: Areas smaller than this (ha) hide small changes at 10 m.
SMALL_AREA_HA = 1.0
#: Below this share of the possible weight a card is contradicted.
CONTRADICTED_SHARE = 0.25

#: Change that is just noise, per measure (indices: 0.05, as the seasonal card's band padding;
#: radar: 1.5 dB). Used for `stable`, threshold margins and "no notable change".
NOISE: dict[str, float] = {
    "greenness": 0.05,
    "moisture": 0.05,
    "water": 0.05,
    "bare": 0.05,
    "burn": 0.05,
    "roughness": 1.5,
    "slope_deg": 1.0,
    "elevation_m": 1.0,
    "rain_mm": 10.0,
    "heat": 1.0,
}
#: Measures that show change on the ground (context measures do not).
_CHANGE_MEASURES = ("greenness", "moisture", "water", "bare", "burn", "roughness")
_ORDER: dict[str, int] = {"supported": 0, "unclear": 1, "untested": 2, "contradicted": 3}
_LEVELS: tuple[Level, ...] = ("Low", "Medium", "High")
_STATUS_CAP: dict[str, Level] = {"draft": "Low", "tested": "Medium", "reviewed": "High"}
_PCT: dict[str, tuple[int, int]] = {"High": (80, 95), "Medium": (55, 79), "Low": (20, 50)}
_SUMMARY_SCENE = re.compile(r"^\d+\s+scenes?$")


# --- Readings -----------------------------------------------------------------------------------


def _float(x: Any) -> float | None:
    if isinstance(x, bool) or not isinstance(x, int | float):
        return None
    v = float(x)
    return v if math.isfinite(v) else None


def _bool(x: Any) -> bool | None:
    return x if isinstance(x, bool) else None


@dataclass(frozen=True)
class Reading:
    """One measure from `findings["observed"]`, with junk values dropped (scripts are
    model-written, so every field is optional and checked)."""

    value: float | None = None
    before: float | None = None
    after: float | None = None
    delta: float | None = None
    inside_band: bool | None = None
    local: bool | None = None
    persistent: bool | None = None
    sudden: bool | None = None
    date: str | None = None

    @classmethod
    def parse(cls, raw: Any) -> Reading | None:
        """A reading from a findings entry (a dict, or a bare number); None if unusable."""
        if _float(raw) is not None:
            return cls(value=_float(raw))
        if not isinstance(raw, Mapping):
            return None
        date = raw.get("date")
        r = cls(
            value=_float(raw.get("value")),
            before=_float(raw.get("before")),
            after=_float(raw.get("after")),
            delta=_float(raw.get("delta")),
            inside_band=_bool(raw.get("inside_band")),
            local=_bool(raw.get("local")),
            persistent=_bool(raw.get("persistent")),
            sudden=_bool(raw.get("sudden")),
            date=date[:10] if isinstance(date, str) and date.strip() else None,
        )
        return None if r == cls() else r

    @property
    def level(self) -> float | None:
        """The latest value: `after`, else `value`."""
        return self.after if self.after is not None else self.value

    @property
    def change(self) -> float | None:
        """`delta`, else `after - before` when both are known."""
        if self.delta is not None:
            return self.delta
        if self.before is not None and self.after is not None:
            return self.after - self.before
        return None


def observed_readings(findings: Mapping[str, Any]) -> dict[str, Reading]:
    """Parse `findings["observed"]` into readings, skipping unusable entries."""
    obs = findings.get("observed") if isinstance(findings, Mapping) else None
    if not isinstance(obs, Mapping):
        return {}
    out: dict[str, Reading] = {}
    for measure, raw in obs.items():
        reading = Reading.parse(raw)
        if isinstance(measure, str) and reading is not None:
            out[measure] = reading
    return out


def fmt_num(v: float) -> str:
    """A number as shown to people: 2 decimals under 10, 1 under 100, else whole."""
    a = abs(v)
    text = f"{v:.2f}" if a < 10 else (f"{v:.1f}" if a < 100 else f"{v:.0f}")
    return text.lstrip("-") if float(text) == 0 else text


def _signed(v: float) -> str:
    text = fmt_num(v)
    return text if text.startswith("-") or float(text) == 0 else f"+{text}"


def _flag(value: bool | None, yes: str, no: str) -> str | None:
    return None if value is None else (yes if value else no)


def observed_text(r: Reading) -> str:
    """What was measured, in short words (numbers come only from the reading)."""
    parts: list[str] = []
    if r.before is not None and r.after is not None:
        parts.append(f"{fmt_num(r.before)} → {fmt_num(r.after)}")
    elif r.level is not None:
        parts.append(fmt_num(r.level))
    if r.delta is not None:
        parts.append(f"({_signed(r.delta)})" if parts else _signed(r.delta))
    flags = [
        _flag(r.inside_band, "inside normal range", "outside normal range"),
        _flag(r.sudden, "sudden", "gradual"),
        _flag(r.local, "local", "regional"),
        _flag(r.persistent, "lasting", "not lasting"),
        f"on {r.date}" if r.date else None,
    ]
    return ", ".join(p for p in [" ".join(parts), *flags] if p) or "measured"


# --- Signs --------------------------------------------------------------------------------------


def _needs_persistence(sign: Sign) -> bool:
    """Card convention: a sign whose `shape` starts with "stays" must last over later images."""
    return (sign.shape or "").strip().lower().startswith("stays")


def expected_text(sign: Sign) -> str:
    """The sign as a short expectation, e.g. "↓ by > 0.15, sudden, local"."""
    by = f" by > {sign.by_more_than:g}" if sign.by_more_than is not None else ""
    t = sign.threshold
    base = {
        "down": f"↓{by}",
        "up": f"↑{by}",
        "below": f"< {t:g}" if t is not None else "low",
        "above": f"> {t:g}" if t is not None else "high",
        "stable": "stable",
        "inside_band": "inside normal range",
        "outside_band": f"outside normal range{by}",
    }[sign.change]
    extra = [
        sign.timing if sign.timing in ("sudden", "gradual") else None,
        sign.spatial if sign.spatial in ("local", "regional") else None,
        "lasting" if _needs_persistence(sign) else None,
        "optional" if sign.optional else None,
    ]
    return ", ".join([base, *(e for e in extra if e)])


def _moved(sign: Sign, r: Reading) -> tuple[SignState, str]:
    """`down` / `up`: moved past `by_more_than` (or noise) in the right direction."""
    d = r.change
    if d is None:
        return "unknown", "change not measured"
    word = "dropped" if sign.change == "down" else "rose"
    moved = -d if sign.change == "down" else d
    need = sign.by_more_than if sign.by_more_than is not None else NOISE.get(sign.measure, 0.0)
    if moved > need:
        return "pass", f"{word} enough"
    if moved <= need / 4:
        return "fail", f"has not {word}" if moved <= 0 else f"{word} too little"
    return "unknown", f"{word}, but less than expected"


def _value_state(sign: Sign, r: Reading) -> tuple[SignState, str]:
    noise = NOISE.get(sign.measure, 0.0)
    by = sign.by_more_than
    match sign.change:
        case "down" | "up":
            return _moved(sign, r)
        case "stable":
            d = r.change
            if d is None:
                return "unknown", "change not measured"
            tol = by if by is not None else (noise or 0.1)
            if abs(d) <= tol:
                return "pass", "stayed stable"
            return ("fail", "changed") if abs(d) > 2 * tol else ("unknown", "changed a little")
        case "above" | "below":
            v, t = r.level, sign.threshold
            if v is None or t is None:
                return "unknown", "value not measured"
            if sign.change == "above":
                if v > t:
                    return "pass", "above the line"
                return ("fail", "not above the line") if v <= t - noise else ("unknown", "near")
            if v < t:
                return "pass", "below the line"
            return ("fail", "not below the line") if v >= t + noise else ("unknown", "near")
        case _:  # inside_band | outside_band
            if r.inside_band is None:
                d = r.change
                if sign.change == "outside_band" and by is not None and d is not None:
                    if abs(d) > by:
                        return "pass", "moved past the normal range"
                    if abs(d) <= by / 4:
                        return "fail", "barely moved"
                return "unknown", "normal range not checked"
            want_inside = sign.change == "inside_band"
            if r.inside_band == want_inside:
                return "pass", "inside the normal range" if want_inside else "outside it"
            return "fail", "outside the normal range" if want_inside else "inside it"


def check_sign(sign: Sign, reading: Reading | None) -> tuple[SignState, str]:
    """Whether one card sign holds for a reading: (state, short reason without numbers)."""
    if reading is None:
        return "unknown", "not measured"
    state: SignState
    if _needs_persistence(sign) and sign.change == "stable":
        if reading.persistent is None:
            state, why = "unknown", "not checked over later images"
        else:
            state, why = ("pass", "lasted") if reading.persistent else ("fail", "did not last")
    else:
        state, why = _value_state(sign, reading)
        if _needs_persistence(sign):
            no_value = reading.level is None and reading.change is None
            if reading.persistent is False:
                state, why = "fail", "did not last"
            elif reading.persistent is True and no_value:
                state, why = "pass", "lasted"
            elif reading.persistent is None and state == "pass":
                state, why = "unknown", f"{why}, but not checked over later images"
    if sign.timing == "sudden" and reading.sudden is False:
        return "fail", "the change was gradual"
    if sign.timing == "gradual" and reading.sudden is True:
        return "fail", "the change was sudden"
    if sign.spatial == "local" and reading.local is False:
        return "fail", "the surroundings changed the same way"
    if sign.spatial == "regional" and reading.local is True:
        return "fail", "only this area changed"
    return state, why


# --- Results ------------------------------------------------------------------------------------


class SignCheck(BaseModel):
    """One sign of a card, checked against the readings."""

    measure: str
    expected: str
    weight: int
    optional: bool
    state: SignState
    why: str


class CardScore(BaseModel):
    """How well one registered card fits the data."""

    card_id: str
    label: str
    status: Literal["draft", "tested", "reviewed"]
    verdict: Verdict
    reason: str
    weight: float = Field(description="Matched + 40% unknown - contradicted sign weights.")
    possible: float = Field(description="Total weight of the counted signs.")
    score: float = Field(description="weight / possible, -1..1; used for ranking and ties.")
    signs: list[SignCheck]
    post_hoc: bool = False
    expected: dict[str, str] = Field(default_factory=dict)
    observed: dict[str, str] = Field(default_factory=dict)


class ScoreResult(BaseModel):
    """Scored hypotheses, ranked best first, with the answer's confidence."""

    cards: list[CardScore] = Field(default_factory=list)
    rows: list[ExpectationRow] = Field(default_factory=list)
    top: str | None = Field(None, description="The one supported cause, if any (no ties).")
    verdicts: dict[str, Verdict] = Field(default_factory=dict)
    scores: dict[str, float] = Field(default_factory=dict)
    confidence: Confidence
    cannot_distinguish: tuple[str, str] | None = None
    settle: str | None = Field(None, description="What would tell the tied pair apart.")
    no_change: bool = Field(False, description="Nothing moved by more than noise.")
    data_read: bool = False
    quality: list[str] = Field(default_factory=list, description="Data-quality warnings.")

    def card(self, card_id: str) -> CardScore | None:
        return next((c for c in self.cards if c.card_id == card_id), None)

    def cause_problem(self, card_id: str) -> str | None:
        """Why `card_id` may not be named as the cause (None when it may)."""
        c = self.card(card_id)
        if c is None:
            return f"'{card_id}' was not registered as a hypothesis before naming it as a cause."
        if c.verdict != "supported":
            return f"The data does not support {c.label.lower()} ({c.verdict}): {c.reason}"
        if self.cannot_distinguish is not None:
            a, b = (self.card(i) for i in self.cannot_distinguish)
            names = " and ".join(x.label.lower() for x in (a, b) if x)
            return f"Can't tell between {names} from this data; do not name one cause."
        if self.top != card_id:
            best = self.card(self.top) if self.top else None
            return f"{best.label} fits the data better." if best else "No cause is supported."
        return None

    def hypothesis_rows(self) -> list[HypothesisRow]:
        """Rows for the `hypotheses` block (ranked, best first)."""
        return [
            HypothesisRow(
                card_id=c.card_id,
                label=c.label,
                expected=c.expected,
                observed=c.observed,
                verdict=c.verdict,
                reason=("Added after the data was seen. " if c.post_hoc else "") + c.reason,
                score=round(c.score, 2) if c.verdict != "untested" else None,
            )
            for c in self.cards
        ]


# --- Scoring ------------------------------------------------------------------------------------


def _by_measure(pairs: Iterable[tuple[str, str]]) -> dict[str, str]:
    out: dict[str, list[str]] = {}
    for measure, text in pairs:
        out.setdefault(measure, []).append(text)
    return {m: "; ".join(v) for m, v in out.items()}


def _is_normal_card(card: EventCard) -> bool:
    """A card whose core signs all say "nothing unusual" (e.g. seasonal)."""
    core = [s for s in card.signs if not s.optional]
    return bool(core) and all(s.change in ("inside_band", "stable") for s in core)


def _list(checks: list[SignCheck], state: SignState, n: int = 2) -> str:
    """The heaviest `n` signs in `state`; failed ones say why (no numbers in `why`)."""
    picked = sorted((c for c in checks if c.state == state), key=lambda c: -c.weight)[:n]
    return "; ".join(
        f"{c.measure} {c.expected}" + (f" ({c.why})" if state == "fail" else "") for c in picked
    )


_REASON_PARTS: dict[str, tuple[tuple[str, SignState], ...]] = {
    "supported": (("Matches", "pass"),),
    "contradicted": (("Does not match", "fail"),),
    "unclear": (("Matches", "pass"), ("Does not match", "fail"), ("Not checked", "unknown")),
}


def _reason(verdict: Verdict, checks: list[SignCheck]) -> str:
    if verdict == "untested":
        return "None of its signs could be measured here."
    out = []
    for label, state in _REASON_PARTS[verdict]:
        text = _list(checks, state)
        if text:
            out.append(f"{label}: {text}.")
    return " ".join(out) or "Its signs are only partly measured."


def _score_card(
    card: EventCard, readings: Mapping[str, Reading], *, no_change: bool, post_hoc: bool
) -> CardScore:
    checks: list[SignCheck] = []
    for sign in card.signs:
        state, why = check_sign(sign, readings.get(sign.measure))
        checks.append(
            SignCheck(
                measure=sign.measure,
                expected=expected_text(sign),
                weight=sign.weight,
                optional=sign.optional,
                state=state,
                why=why,
            )
        )
    counted = [c for c in checks if not c.optional or c.state == "pass"]
    possible = float(sum(c.weight for c in counted))
    weight = sum(
        {"pass": c.weight, "unknown": UNKNOWN_SHARE * c.weight, "fail": -c.weight}[c.state]
        for c in counted
    )
    ratio = weight / possible if possible else 0.0
    anchor = max((c.weight for c in checks if not c.optional), default=0)

    extra = ""
    if all(c.state == "unknown" for c in counted):
        verdict: Verdict = "untested"
    elif (
        any(c.state == "fail" and not c.optional and c.weight == anchor for c in checks)
        or ratio < CONTRADICTED_SHARE
    ):
        verdict = "contradicted"
    elif weight >= card.confidence.medium_min_weight:
        verdict = "supported"
        if not any(c.state == "pass" and c.measure not in MEASURES_CONTEXT for c in checks):
            verdict, extra = "unclear", "Only context signs match, not a change on the ground."
        elif no_change and _is_normal_card(card):
            verdict, extra = "unclear", "Nothing moved by more than noise: no notable change."
    else:
        verdict = "unclear"

    expected = _by_measure((s.measure, expected_text(s)) for s in card.signs)
    observed = {m: observed_text(readings[m]) for m in expected if m in readings}
    reason = f"{extra} {_reason(verdict, checks)}".strip() if extra else _reason(verdict, checks)
    return CardScore(
        card_id=card.id,
        label=card.name,
        status=card.status,
        verdict=verdict,
        reason=reason,
        weight=round(weight, 3),
        possible=possible,
        score=round(ratio, 4),
        signs=checks,
        post_hoc=post_hoc,
        expected=expected,
        observed=observed,
    )


def _no_change(readings: Mapping[str, Reading]) -> bool:
    """True when ground-change measures were compared and none moved beyond noise."""
    deltas = [
        (m, r.change) for m, r in readings.items() if m in _CHANGE_MEASURES and r.change is not None
    ]
    return bool(deltas) and all(abs(d) <= NOISE[m] for m, d in deltas)


def _clearly_better(a: float, b: float) -> bool:
    """Score `a` beats `b` by more than the tie margin."""
    return a > 0 and a - b > TIE_MARGIN * a


def _demote_lookalikes(cards: list[CardScore], kb: KnowledgeBase) -> None:
    """A supported card is only asserted when no registered look-alike fits clearly better."""
    prelim = {c.card_id: c for c in cards}
    supported = {cid for cid, c in prelim.items() if c.verdict == "supported"}
    for c in cards:
        if c.card_id not in supported:
            continue
        for la in kb.events[c.card_id].looks_like:
            other = prelim.get(la.event)
            if other and la.event in supported and _clearly_better(other.score, c.score):
                c.verdict = "unclear"
                c.reason = f"{other.label} fits the data better. {c.reason}"
                break


def _tell_apart(kb: KnowledgeBase, a: str, b: str) -> str | None:
    for x, y in ((a, b), (b, a)):
        for la in kb.events[x].looks_like:
            if la.event == y:
                return la.tell_apart_by
    return None


def _near_tie(cards: list[CardScore], beaten: set[str]) -> tuple[CardScore, CardScore] | None:
    """The leader and the next contender within the tie margin (ranked `cards`), if any.

    Cards already beaten on their discriminating measures are no longer contenders."""
    if not cards or cards[0].verdict != "supported":
        return None
    first = cards[0]
    rivals = [
        c for c in cards[1:] if c.card_id not in beaten and c.verdict in ("supported", "unclear")
    ]
    if not rivals:
        return None
    other = max(rivals, key=lambda c: c.score)  # first of equals: the ranking decides
    return None if _clearly_better(first.score, other.score) else (first, other)


def _discriminating(kb: KnowledgeBase, a: str, b: str) -> list[str]:
    """Measures the two cards' `looks_like` entries say tell them apart (both directions)."""
    out: dict[str, None] = {}
    for x, y in ((a, b), (b, a)):
        for la in kb.events[x].looks_like:
            if la.event == y:
                out.update(dict.fromkeys(la.discriminating_measures))
    return list(out)


def _net(card: CardScore, measures: Iterable[str]) -> float:
    """Confirmed minus contradicted sign weight on `measures` (unknowns count nothing)."""
    wanted = set(measures)
    return float(
        sum(
            c.weight if c.state == "pass" else -c.weight
            for c in card.signs
            if c.measure in wanted and (c.state == "pass" or (c.state == "fail" and not c.optional))
        )
    )


#: The generic fallback card: it fits any new bare ground, so a specific look-alike that
#: also fits wins whenever the before-state check below says which one it is.
GENERIC_CARD = "new_bare_or_built"
#: Below this greenness after the change, ground is near bare (new_bare_or_built's
#: `tell_apart_by`: "drops to near-zero NDVI"; vegetation loss "stays above about 0.2").
NEAR_BARE_GREENNESS = 0.2
#: The bare-ground rise new bare or built ground shows ("an NDBI rise of more than 0.15").
BARE_RISE = 0.15


def _pond_vs_generic(readings: Mapping[str, Reading]) -> str | None:
    """Pond filling must start from open water (water above 0 before); the cards'
    `tell_apart_by`. None when the water before the change was not measured."""
    water = readings.get("water")
    if water is None or water.before is None:
        return None
    return "pond_filling" if water.before > 0 else GENERIC_CARD


def _vegetation_vs_generic(readings: Mapping[str, Reading]) -> str | None:
    """Near-zero greenness after the change with a clear bare-ground rise is new bare
    ground; greenness that stays above about 0.2 is vegetation loss."""
    green, bare = readings.get("greenness"), readings.get("bare")
    level = green.level if green is not None else None
    if level is None:
        return None
    if level >= NEAR_BARE_GREENNESS:
        return "vegetation_loss"
    rise = bare.change if bare is not None else None
    return GENERIC_CARD if rise is not None and rise > BARE_RISE else None


#: Tie-break checks code can verify, per look-alike pair (from the cards' `tell_apart_by`):
#: each returns the card that fits, or None when the deciding reading is missing.
TIE_RULES: dict[frozenset[str], Callable[[Mapping[str, Reading]], str | None]] = {
    frozenset({"pond_filling", GENERIC_CARD}): _pond_vs_generic,
    frozenset({"vegetation_loss", GENERIC_CARD}): _vegetation_vs_generic,
}


def _demote(winner: CardScore, loser: CardScore, why: str) -> CardScore:
    if loser.verdict == "supported":
        loser.verdict = "unclear"
    loser.reason = f"{winner.label} fits better {why}. {loser.reason}"
    return loser


def _break_tie(
    kb: KnowledgeBase,
    a: CardScore,
    b: CardScore,
    readings: Mapping[str, Reading] | None = None,
) -> CardScore | None:
    """Settle a near tie between look-alikes: first by the before-state check the cards name
    (`TIE_RULES`, e.g. pond filling needs open water before), then on the measures that tell
    them apart (the card whose predictions there were clearly more confirmed wins). Returns
    the loser, or None."""
    rule = TIE_RULES.get(frozenset({a.card_id, b.card_id}))
    pick = rule(readings or {}) if rule is not None else None
    if pick is not None:
        winner, loser = (a, b) if pick == a.card_id else (b, a)
        if winner.verdict == "supported":
            return _demote(winner, loser, "on the state before the change")
    measures = _discriminating(kb, a.card_id, b.card_id)
    if not measures:
        return None
    na, nb = _net(a, measures), _net(b, measures)
    if _clearly_better(na, nb):
        winner, loser = a, b
    elif _clearly_better(nb, na):
        winner, loser = b, a
    else:
        return None
    if loser.verdict == "supported":
        loser.verdict = "unclear"
    loser.reason = (
        f"{winner.label} fits better on what tells them apart ({', '.join(measures)}). "
        f"{loser.reason}"
    )
    return loser


# --- Data quality and confidence ----------------------------------------------------------------


def _walk_values(obj: Any, key: str) -> Iterable[Any]:
    if isinstance(obj, Mapping):
        for k, v in obj.items():
            if k == key:
                yield v
            yield from _walk_values(v, key)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_values(v, key)


def data_quality(state: AgentState) -> list[str]:
    """Plain-word warnings that lower confidence (no numbers, so they pass the answer checks)."""
    issues: list[str] = []
    px = [v for v in (_float(x) for x in _walk_values(state.evidence, "clean_px")) if v is not None]
    if px and min(px) < MIN_CLEAN_PX:
        issues.append("Few clear pixels were measured, so the values are noisy.")
    scenes = [s for s in _walk_values(state.evidence, "scene") if isinstance(s, str) and s]
    single = {s for s in scenes if not _SUMMARY_SCENE.match(s.strip())}
    if scenes and len(single) == 1 and len(single) == len(set(scenes)):
        issues.append("Only one satellite image was measured, so change over time is unchecked.")
    area = state.place.area_ha if state.place else None
    if area is not None and area < SMALL_AREA_HA:
        issues.append("The area is small for the satellite's pixel size; small changes may hide.")
    return issues


def _cap(level: Level, cap: Level) -> Level:
    return _LEVELS[min(_LEVELS.index(level), _LEVELS.index(cap))]


def _down(level: Level) -> Level:
    return _LEVELS[max(_LEVELS.index(level) - 1, 0)]


def _pct(level: Level, ratio: float) -> int:
    lo, hi = _PCT[level]
    return max(lo, min(hi, round(100 * ratio)))


def _confidence(
    top: CardScore | None,
    card: EventCard | None,
    *,
    data_read: bool,
    tie: tuple[CardScore, CardScore] | None,
    quality: list[str],
) -> Confidence:
    if not data_read:
        return Confidence(level="Low", pct=20, note="No satellite data was read for this answer.")
    if tie is not None:
        a, b = tie
        note = f"Can't tell between {a.label.lower()} and {b.label.lower()} from this data."
        return Confidence(level="Low", pct=35, note=note)
    if top is None or card is None:
        note = "No cause fits the data well enough to name one."
        return Confidence(level="Low", pct=25, note=" ".join([note, *quality[:1]]))
    hi, med = card.confidence.high_min_weight, card.confidence.medium_min_weight
    base: Level = "High" if top.weight >= hi else ("Medium" if top.weight >= med else "Low")
    level = base
    why: list[str] = []
    if top.post_hoc:
        level = "Low"
        why.append("this cause was only considered after the data was seen")
    status_cap = _STATUS_CAP[card.status]
    if _cap(level, status_cap) != level:
        level = _cap(level, status_cap)
        why.append(
            "the knowledge card is a draft, not yet tested on known cases"
            if card.status == "draft"
            else "the knowledge card is tested but not yet reviewed"
        )
    for _ in quality:
        level = _down(level)
    strength = {"High": "Nearly all", "Medium": "Most", "Low": "Some"}[base]
    note = f"{strength} signs of {card.name.lower()} match the data"
    note += f", but {' and '.join(why)}." if why else "."
    if quality:
        note += f" {quality[0]}"
    return Confidence(level=level, pct=_pct(level, top.score), note=note)


# --- Public -------------------------------------------------------------------------------------


def score(state: AgentState, kb: KnowledgeBase) -> ScoreResult:
    """Score every registered event card against `state.findings["observed"]`."""
    readings: dict[str, Reading] = {}
    if state.data_read:
        context = observed_readings({"observed": state.context_observed})
        readings = {**context, **observed_readings(state.findings)}
    no_change = _no_change(readings)
    ids = [cid for cid in dict.fromkeys(state.hypotheses) if cid in kb.events]
    post_hoc = set(state.post_hoc)
    cards = [
        _score_card(kb.events[cid], readings, no_change=no_change, post_hoc=cid in post_hoc)
        for cid in ids
    ]
    _demote_lookalikes(cards, kb)
    order = {cid: i for i, cid in enumerate(ids)}
    beaten: set[str] = set()
    tie: tuple[CardScore, CardScore] | None = None
    while True:
        cards.sort(key=lambda c: (_ORDER[c.verdict], -c.score, order[c.card_id]))
        tie = _near_tie(cards, beaten)
        loser = _break_tie(kb, *tie, readings) if tie else None
        if loser is None:
            break
        beaten.add(loser.card_id)
    first = cards[0] if cards and cards[0].verdict == "supported" else None
    top = first if tie is None else None
    quality = data_quality(state) if state.data_read else []
    confidence = _confidence(
        top,
        kb.events[top.card_id] if top else None,
        data_read=state.data_read,
        tie=tie,
        quality=quality,
    )
    rows = [
        ExpectationRow(
            hypothesis=c.card_id, expected=c.expected, observed=c.observed, verdict=c.verdict
        )
        for c in cards
    ]
    return ScoreResult(
        cards=cards,
        rows=rows,
        top=top.card_id if top else None,
        verdicts={c.card_id: c.verdict for c in cards},
        scores={c.card_id: c.score for c in cards},
        confidence=confidence,
        cannot_distinguish=(tie[0].card_id, tie[1].card_id) if tie else None,
        settle=_tell_apart(kb, tie[0].card_id, tie[1].card_id) if tie else None,
        no_change=no_change,
        data_read=state.data_read,
        quality=quality,
    )


def expected_rows(kb: KnowledgeBase, card_ids: Iterable[str]) -> list[ExpectationRow]:
    """Expectation rows from the cards alone (for `hypotheses_registered`, before data)."""
    rows = []
    for cid in dict.fromkeys(card_ids):
        card = kb.events.get(cid)
        if card is not None:
            expected = _by_measure((s.measure, expected_text(s)) for s in card.signs)
            rows.append(ExpectationRow(hypothesis=cid, expected=expected))
    return rows


def hypotheses_block(
    result: ScoreResult,
    *,
    id: str | None = None,
    title: str = "What else could it be",
    caption: str | None = None,
) -> HypothesesBlock:
    """The "What else could it be" block (HANDOFF B9) from a score result."""
    if caption is None:
        if result.cannot_distinguish:
            a, b = (result.card(i) for i in result.cannot_distinguish)
            names = " and ".join(x.label.lower() for x in (a, b) if x)
            caption = f"Can't tell between {names} from this data."
        else:
            caption = "Each cause checked by code against its knowledge card, best fit first."
    return earth.show.hypotheses(
        result.hypothesis_rows(),
        title=title,
        caption=caption,
        post_hoc=any(c.post_hoc for c in result.cards),
        id=id,
    )
