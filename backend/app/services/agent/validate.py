"""Finish validation (HANDOFF B3.5, ARCHITECTURE §4.0): code checks every drafted answer.

`validate_finish(args, state, kb, scoring)` returns the problems (empty = accepted); each one
is written for the model, which gets them back as a tool error and revises. Checks:

- Numbers: every number in the title, sentence, cause, todo, stats and caveats must come from
  the run (script results, findings, evidence, notes, blocks, place facts, and the quotable
  numbers of the cards in play: sign thresholds, normal ranges, `cannot_tell` and
  `tell_apart_by`), with rounding to the decimals written, or as a percent of a fraction.
  Date parts, years (no thousands comma, no unit after) and small integers (0-12) are free.
  Spelled-out numbers and decimal commas are rejected (digits only). Each rejected number is
  explained.
- Cause: a cause needs a registered, read event card that code scoring marks `supported`
  and allows (`ScoreResult.cause_problem`: the top card, no "can't tell between" tie), as
  `agent.answer.build_answer` does, and the cause text must use that card's wording (and
  name no other event card); measure-only answers and runs that read no data name no cause,
  not even in the title, sentence or todo (unless hedged: "can't tell whether ...").
- Wording: the avoid lists of the cards in play, blame phrases (who did it, illegal, ...),
  links, secrets and instruction-like text are rejected ("whether people filled it" is a
  hedge, not blame).
- Memory: no remembered value (private) may appear in any text.
- Shape: caveats for place answers, length caps, a known primary block.

Template (measure-only) answers for runs that hit a cap are built by `agent.answer`.
"""

from __future__ import annotations

import bisect
import dataclasses
import json
import math
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.core.config import settings
from app.services.agent import guard as guard_mod
from app.services.agent.state import AgentState
from knowledge import ALL_MEASURES, EventCard, KnowledgeBase

__all__ = [
    "BLAME_PHRASES",
    "DATA_TOOLS",
    "INSTRUCTION_RE",
    "STATS_MAX",
    "Cited",
    "FinishArgs",
    "StatArg",
    "avoid_phrases",
    "card_numbers",
    "check_cause_wording",
    "check_memory",
    "check_numbers",
    "check_output_safety",
    "check_wording",
    "data_results",
    "extract_numbers",
    "finish_texts",
    "instruction_like",
    "leaks_memory",
    "number_sources",
    "number_style_problems",
    "public_text",
    "parse_finish",
    "redact_secrets",
    "score_verdict",
    "validate_finish",
]

# --- Finish arguments ---------------------------------------------------------------------------

TITLE_MAX = 120
SENTENCE_MAX = 400
CAUSE_MAX = 300
TODO_MAX = 300
#: Same cap as `agent.answer.MAX_STATS` (more would be dropped from the answer).
STATS_MAX = 4
STAT_LABEL_MAX = 40
STAT_VALUE_MAX = 40
CAVEATS_MAX = 6
CAVEAT_MAX = 300
FOLLOWUPS_MAX = 3
FOLLOWUP_MAX = 120
MAX_NUMBER_PROBLEMS = 8

#: Tools whose successful results count as sources of numbers (never `finish` or `ask_user`
#: results: a rejected number echoed in a finish error must not become allowed). Card
#: numbers come only from the quotable card fields (`card_numbers`), not the whole card view.
DATA_TOOLS = frozenset({"run_code", "run_skill"})


#: A literal JSON escape left in model text ("\\u2192" for an arrow): seen on Claude's
#: re-drafts after a rejected `finish`. Decoded to the character it names.
_LITERAL_ESCAPE_RE = re.compile(r"\\u([0-9a-fA-F]{4})")
#: Line breaks, tabs and other control characters: every answer text is one plain line.
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


def _unescape(text: str) -> str:
    """`text` with literal `\\uXXXX` escapes decoded (control characters are left for the
    shape check to reject)."""

    def one(m: re.Match[str]) -> str:
        ch = chr(int(m.group(1), 16))
        return m.group(0) if _CONTROL_RE.match(ch) or 0xD800 <= ord(ch) <= 0xDFFF else ch

    return _LITERAL_ESCAPE_RE.sub(one, text)


class StatArg(BaseModel):
    """One headline number of the answer (becomes `StatItem{l, v}`)."""

    model_config = ConfigDict(str_strip_whitespace=True)

    label: str
    value: str

    @field_validator("label", "value")
    @classmethod
    def _decode(cls, v: str) -> str:
        return _unescape(v)


class FinishArgs(BaseModel):
    """The `finish` tool input: the drafted answer the loop turns into an `Answer`."""

    model_config = ConfigDict(str_strip_whitespace=True)

    title: str
    sentence: str
    cause_card_id: str | None = None
    cause: str | None = None
    todo: str | None = None
    stats: list[StatArg] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)
    primary_block_id: str | None = None
    followups: list[str] = Field(default_factory=list)
    measure_only: bool = False

    @field_validator("cause_card_id", "cause", "todo", "primary_block_id", mode="before")
    @classmethod
    def _blank_is_none(cls, v: Any) -> Any:
        return None if isinstance(v, str) and not v.strip() else v

    @field_validator("caveats", "followups")
    @classmethod
    def _drop_blank(cls, v: list[str]) -> list[str]:
        return [_unescape(s) for s in v if s]

    @field_validator("title", "sentence", "cause", "todo")
    @classmethod
    def _decode(cls, v: str | None) -> str | None:
        return None if v is None else _unescape(v)


def finish_texts(args: FinishArgs) -> list[tuple[str, str]]:
    """Every text of the answer as (field, text), in display order."""
    out: list[tuple[str, str]] = [("title", args.title), ("sentence", args.sentence)]
    if args.cause:
        out.append(("cause", args.cause))
    if args.todo:
        out.append(("todo", args.todo))
    for i, s in enumerate(args.stats):
        out += [(f"stats[{i}].label", s.label), (f"stats[{i}].value", s.value)]
    out += [(f"caveats[{i}]", c) for i, c in enumerate(args.caveats)]
    out += [(f"followups[{i}]", f) for i, f in enumerate(args.followups)]
    return out


# --- Numbers --------------------------------------------------------------------------------------

_MONTH = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?"
    r"|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?![a-z])"
)
#: The months that are not also an English verb ("37 may have been filled" is no date).
_MONTH_NOT_MAY = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|june?|july?|aug(?:ust)?"
    r"|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?![a-z])"
)
#: Not followed by a word or a decimal part ("2026-09-30." at a sentence end is a date).
_END = r"(?!\w|\.\d)"
_DATE_RES = (
    re.compile(rf"(?<![\w.])\d{{4}}-\d{{1,2}}-\d{{1,2}}{_END}"),
    re.compile(rf"(?<![\w.])\d{{4}}-\d{{1,2}}{_END}"),
    re.compile(rf"(?<![\w.])\d{{1,2}}/\d{{1,2}}/\d{{2,4}}{_END}"),
    re.compile(
        rf"(?<![\w.])\d{{1,2}}(?:st|nd|rd|th)?\s+(?:of\s+)?{_MONTH_NOT_MAY}(?:,?\s+\d{{4}})?",
        re.I,
    ),
    # "12 May": only in a date context (an ordinal, "of", a year or punctuation after), so
    # "37 may have been filled" keeps its number.
    re.compile(
        r"(?<![\w.])\d{1,2}(?:(?:st|nd|rd|th)\s+(?:of\s+)?|\s+of\s+)may\b(?:,?\s+\d{4})?"
        r"|(?<![\w.])\d{1,2}\s+may(?:,?\s+\d{4}|(?=\s*(?:[.,;:)!?]|$)))",
        re.I,
    ),
    re.compile(rf"(?<![a-z]){_MONTH}\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s+\d{{4}})?{_END}", re.I),
    re.compile(rf"(?<![a-z]){_MONTH},?\s+\d{{4}}{_END}", re.I),
)
_NUMBER_RE = re.compile(
    r"(?<![\w.])"
    r"(?P<sign>[-−+](?=\.?\d))?"
    r"(?P<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)"
    r"(?P<pct>\s?(?:%|per\s?cent\b))?",
    re.I,
)
_UNIT_AFTER_RE = re.compile(
    r"\s*(?:ha\b|hectares?\b|m\b|m²|m2\b|km|mm\b|cm\b|db\b|°|deg|px\b|pixels?\b|scenes?\b"
    r"|images?\b|passes\b|ponds?\b|times\b)",
    re.I,
)
#: A word after a number that makes it a quantity, not a year ("1950 square metres").
_QUANTITY_AFTER_RE = re.compile(
    r"\s*(?:square|sq\b|cubic|metres?|meters?|kilometres?|kilometers?|tonnes?|tons?\b|kg\b"
    r"|kilograms?|acres?|feet|foot|ft\b|miles?|litres?|liters?|percent|per\s?cent|of\b"
    r"|trucks?|lorries|lorry|loads?|plots?|lots?|fields?|buildings?|houses?|trees?"
    r"|units?|households?|people|persons?)",
    re.I,
)
SMALL_INT_MAX = 12
YEAR_RANGE = (1900, 2100)
#: Spelled-out numbers above the free small integers: they would dodge the number check.
_WORD_NUMBER_RE = re.compile(
    r"\b(?:thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty"
    r"|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?"
    r"|billions?|dozens)\b",
    re.I,
)
#: A decimal comma ("4,6 ha"): read as two free small integers otherwise.
_DECIMAL_COMMA_RE = re.compile(r"(?<![\w.,])\d+,(?:\d{1,2}|\d{4,})(?![\d,])")


@dataclass(frozen=True)
class Cited:
    """A number as written in the answer."""

    text: str
    value: float
    decimals: int
    signed: bool
    pct: bool
    unit_after: bool
    grouped: bool = False
    quantity_after: bool = False

    @property
    def free(self) -> bool:
        """Small integers and years need no source. A year is written without a thousands
        comma and with no unit or quantity word after it ("1,950 m²" is not a year)."""
        if self.decimals or self.pct or self.signed or not self.value.is_integer():
            return False
        if 0 <= self.value <= SMALL_INT_MAX:
            return True
        if self.grouped or self.unit_after or self.quantity_after:
            return False
        return YEAR_RANGE[0] <= self.value <= YEAR_RANGE[1]


def _strip_dates(text: str) -> str:
    for rx in _DATE_RES:
        text = rx.sub(" ", text)
    return text


def extract_numbers(text: str, *, dates: bool = False) -> list[Cited]:
    """Numbers in `text` (decimals, negatives, percentages, 1,234 thousands).

    Dates ("2026-09-12", "12 Sep 2026", "Sep 2026") are removed first unless `dates`.
    A sign counts only when it is not glued to a word or number, so "3.9-5.3" is a range.
    """
    if not dates:
        text = _strip_dates(text)
    out: list[Cited] = []
    for m in _NUMBER_RE.finditer(text):
        num = m.group("num")
        try:
            value = float(num.replace(",", ""))
        except ValueError:  # pragma: no cover - the regex only matches numbers
            continue
        sign = m.group("sign")
        if sign in ("-", "−"):
            value = -value
        decimals = len(num.split(".", 1)[1]) if "." in num else 0
        out.append(
            Cited(
                text=m.group(0).strip(),
                value=value,
                decimals=decimals,
                signed=bool(sign),
                pct=bool(m.group("pct")),
                unit_after=bool(_UNIT_AFTER_RE.match(text, m.end())),
                grouped="," in num,
                quantity_after=bool(_QUANTITY_AFTER_RE.match(text, m.end())),
            )
        )
    return out


def number_style_problems(name: str, text: str) -> list[str]:
    """Numbers written in a way the check cannot verify: spelled out, or a decimal comma."""
    problems: list[str] = []
    word = _WORD_NUMBER_RE.search(text)
    if word:
        problems.append(
            f"{name}: write '{word.group(0)}' in digits, as the tools returned it, so it can be "
            "checked against the run's numbers."
        )
    comma = _DECIMAL_COMMA_RE.search(_strip_dates(text))
    if comma:
        problems.append(
            f"{name}: '{comma.group(0)}' uses a decimal comma; write decimals with a point "
            "(e.g. '4.6') and thousands as '1,234'."
        )
    return problems


def _plain(obj: Any) -> Any:
    """A JSON-like view of models, dataclasses and plain values."""
    if isinstance(obj, BaseModel):
        return obj.model_dump(mode="json")
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        try:
            return dataclasses.asdict(obj)
        except TypeError:
            return {f.name: getattr(obj, f.name, None) for f in dataclasses.fields(obj)}
    return obj


def _collect(obj: Any, out: list[float], depth: int = 0) -> None:
    if depth > 12 or obj is None:
        return
    obj = _plain(obj)
    if isinstance(obj, bool):
        return
    if isinstance(obj, int | float):
        if math.isfinite(obj):
            out.append(float(obj))
    elif isinstance(obj, str):
        out.extend(c.value for c in extract_numbers(obj, dates=True))
    elif isinstance(obj, Mapping):
        for v in obj.values():
            _collect(v, out, depth + 1)
    elif isinstance(obj, list | tuple | set | frozenset):
        for v in obj:
            _collect(v, out, depth + 1)
    elif hasattr(obj, "__dict__"):
        _collect(vars(obj), out, depth + 1)
    else:
        _collect(str(obj), out, depth + 1)


def _tool_names(state: AgentState) -> dict[str, str]:
    return {c.id: c.name for m in state.transcript if m.role == "assistant" for c in m.tool_calls}


def data_results(state: AgentState) -> list[str]:
    """Contents of the successful data-tool results the model has been sent (or will be)."""
    names = _tool_names(state)
    results = [r for m in state.transcript if m.role == "user" for r in m.tool_results]
    results += state.pending_results
    return [r.content for r in results if not r.is_error and names.get(r.call_id) in DATA_TOOLS]


def _card_ids(state: AgentState, cause: str | None = None) -> list[str]:
    ids = [*state.cards_read, *state.hypotheses, *([cause] if cause else [])]
    return list(dict.fromkeys(ids))


def _card_dump(kb: KnowledgeBase, card_id: str) -> str | None:
    """A card's header (JSON) and body as one text, or None for an unknown id."""
    try:
        card = kb.get(card_id)
    except KeyError:
        return None
    header = json.dumps(card.model_dump(mode="json"), ensure_ascii=False)
    return header + "\n" + kb.bodies.get(card_id, "")


def card_numbers(kb: KnowledgeBase, card_id: str) -> list[float]:
    """The numbers of a card a model may quote: sign thresholds and `by_more_than`, a setting
    card's normal ranges, and numbers in `cannot_tell` and `tell_apart_by` (never case
    coordinates, dates or sources, confidence weights, versions or sizes). [] for an unknown id.
    """
    try:
        card = kb.get(card_id)
    except KeyError:
        return []
    out: list[float] = []
    texts: list[str] = []
    if isinstance(card, EventCard):
        for sign in card.signs:
            out += [float(v) for v in (sign.threshold, sign.by_more_than) if v is not None]
        texts = [*card.cannot_tell, *(la.tell_apart_by for la in card.looks_like)]
    else:
        for n in card.normal:
            out += [float(v) for v in (n.typical_min, n.typical_max) if v is not None]
    for text in texts:
        out += [c.value for c in extract_numbers(text, dates=True)]
    return out


def _policy_text(state: AgentState, kb: KnowledgeBase) -> str | None:
    """The policy note the model was given for the guard's rule (from rules.yaml, e.g. "about
    25 km2" for `area_too_large`); never the guard model's own `reason`."""
    rule_id = state.guard.rule_id if state.guard else None
    if not rule_id:
        return None
    try:
        rule = kb.rule(rule_id)
    except KeyError:
        return None
    return guard_mod.policy_note(kb, rule)


def number_sources(
    state: AgentState,
    kb: KnowledgeBase,
    scoring: Any = None,
    extra_sources: Iterable[Any] = (),
) -> list[float]:
    """Every number the run produced or was given by code: findings, evidence, notes, place
    facts, the quotable numbers of the cards in play (read or registered, `card_numbers`),
    the guard rule's policy note, script results, scoring, `extra_sources`
    (e.g. full blocks, earth call summaries). Never the model's own text or the question."""
    out: list[float] = []
    parts = (state.findings, state.evidence, state.notes, state.place, data_results(state))
    for part in (*parts, state.carried_results):
        _collect(part, out)
    for cid in _card_ids(state):
        out += card_numbers(kb, cid)
    _collect(_policy_text(state, kb), out)
    if scoring is not None:
        _collect(scoring, out)
    for extra in extra_sources:
        _collect(extra, out)
    return out


class _Pool:
    """Sorted source numbers for tolerance lookups."""

    def __init__(self, values: Iterable[float]) -> None:
        vals = [v for v in values if math.isfinite(v)]
        self.signed = sorted(vals)
        self.absolute = sorted(abs(v) for v in vals)

    @staticmethod
    def _near(arr: list[float], x: float, tol: float) -> bool:
        i = bisect.bisect_left(arr, x - tol)
        return i < len(arr) and arr[i] <= x + tol

    @staticmethod
    def _closest(arr: list[float], x: float) -> float | None:
        if not arr:
            return None
        i = bisect.bisect_left(arr, x)
        near = [arr[j] for j in (i - 1, i) if 0 <= j < len(arr)]
        return min(near, key=lambda v: abs(v - x))

    def _arr(self, c: Cited) -> tuple[list[float], float]:
        return (self.signed, c.value) if c.signed else (self.absolute, abs(c.value))

    def has(self, c: Cited) -> bool:
        tol = 0.5 * 10.0 ** (-c.decimals) + 1e-9
        arr, x = self._arr(c)
        if self._near(arr, x, tol):
            return True
        return c.pct and self._near(arr, x / 100, tol / 100)

    def closest(self, c: Cited) -> str | None:
        arr, x = self._arr(c)
        best = self._closest(arr, x)
        if c.pct:
            frac = self._closest(arr, x / 100)
            if frac is not None and (best is None or abs(frac * 100 - x) < abs(best - x)):
                return f"{_fmt(frac)} (= {_fmt(frac * 100)}%)"
        return None if best is None else _fmt(best)


def _fmt(v: float) -> str:
    return f"{v:.4f}".rstrip("0").rstrip(".") or "0"


def check_numbers(fields: Sequence[tuple[str, str]], sources: Iterable[float]) -> list[str]:
    """One problem per number that is not free and matches no source (explained)."""
    pool = _Pool(sources)
    problems: list[str] = []
    for name, text in fields:
        problems += number_style_problems(name, text)
        for c in extract_numbers(text):
            if c.free or pool.has(c):
                continue
            near = pool.closest(c)
            hint = f" The closest number the run produced is {near}." if near else ""
            problems.append(
                f"{name}: the number '{c.text}' does not come from the run (tool results, "
                f"cards or place facts), even after rounding.{hint} Quote numbers as the "
                "tools returned them (rounding is fine), or compute new ones in a script first."
            )
    if len(problems) > MAX_NUMBER_PROBLEMS:
        more = len(problems) - MAX_NUMBER_PROBLEMS
        problems = [*problems[:MAX_NUMBER_PROBLEMS], f"... and {more} more unsupported numbers."]
    return problems


# --- Wording --------------------------------------------------------------------------------------

#: Blame phrasing never allowed in an answer (HANDOFF B3.5, B7.3 `ownership_or_blame`).
BLAME_PHRASES: tuple[str, ...] = (
    "illegal",
    "illegally",
    "unlawful",
    "unlawfully",
    "dumped by",
    "responsible",
    "culprit",
    "perpetrator",
    "to blame",
    "at fault",
    "guilty",
    "criminal",
    "unauthorised",
    "unauthorized",
    "violation",
)
_ACTOR = (
    r"(?:owners?|landowners?|land\s+owners?|developers?|villagers?|compan(?:y|ies)|government"
    r"|contractors?|farmers?|someone|somebody|people|persons?|operators?|residents?"
    r"|neighbou?rs?|authorit(?:y|ies)|officials?)"
)
_ACTION = (
    r"(?:filled|dumped|cleared|built|done|carried\s+out|reclaimed|destroyed|damaged|cut(?:\s+down)?"
    r"|logged|bulldozed|demolished|burn(?:ed|t)|set|started|drained|caused|removed)"
)
#: "filled by the owner", "the developer dumped": never assert who did it.
_BLAME_RES: tuple[re.Pattern[str], ...] = (
    re.compile(
        rf"\b{_ACTION}\s+(?:(?:in|up|out)\s+)?by\s+(?:(?:the|a|an|some|local)\s+)*{_ACTOR}\b",
        re.I,
    ),
    re.compile(rf"\b{_ACTOR}\s+(?:(?:has|have|had)\s+)?(?:\w+ly\s+)?{_ACTION}\b", re.I),
)
_BLAME_HELP = "never say who did it, or that it was illegal; describe what the images show"
#: "cannot tell whether people filled it" names no one: an actor right after these is hedged.
_HEDGE_RE = re.compile(r"\b(?:whether|if)\s+(?:(?:the|a|an|some|local)\s+)*$", re.I)


def _hedged(text: str, start: int) -> bool:
    return bool(_HEDGE_RE.search(text[max(0, start - 40) : start]))


_LINK_RE = re.compile(r"https?://|\bwww\.", re.I)
_SECRET_RE = re.compile(r"\bsk-[A-Za-z0-9_-]{6,}|[A-Za-z0-9_+/=-]{40,}")
#: Text that tries to instruct a model (in answers, proposals, data).
INSTRUCTION_RE = re.compile(
    r"ignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|your)\s+"
    r"(?:instructions|rules|messages|prompts?)"
    r"|disregard\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|your)\b"
    r"|forget\s+(?:all\s+|your\s+|the\s+)?(?:previous\s+|prior\s+)?(?:instructions|rules)"
    r"|override\s+(?:the\s+|your\s+|all\s+)?(?:rules|policy|instructions|safety|guard)"
    r"|system\s+prompt|you\s+are\s+now\b|developer\s+mode|jailbreak|do\s+anything\s+now"
    r"|new\s+instructions|<\s*/?\s*(?:system|assistant|user|instructions?)\s*>"
    r"|^\s*(?:system|assistant)\s*:",
    re.I | re.M,
)


#: Key-shaped strings to redact from anything a script returns (Anthropic keys first).
_KEY_RE = re.compile(r"sk-ant-[A-Za-z0-9_-]{8,}|\bsk-[A-Za-z0-9_-]{20,}")
REDACTED = "[redacted]"


def redact_secrets(text: str) -> str:
    """`text` with API-key-shaped strings and the configured Anthropic key replaced by
    `REDACTED` (scripts can read what the server process can; nothing key-like may reach the
    model, the stored run or a published block)."""
    out = _KEY_RE.sub(REDACTED, text)
    key = settings.anthropic_api_key
    secret = key.get_secret_value() if key is not None else ""
    if len(secret) >= 8 and secret in out:
        out = out.replace(secret, REDACTED)
    return out


def instruction_like(text: str) -> bool:
    """True when `text` reads like instructions to a model (prompt injection)."""
    return bool(INSTRUCTION_RE.search(text))


def _phrase_re(phrase: str, *, placeholders: bool = True) -> re.Pattern[str] | None:
    """A case-insensitive pattern for an avoid phrase.

    Parenthesised notes are dropped ("was caused by (a person, ...)"), a standalone "X" is a
    wildcard ("lost X% of its water"), and ASCII words match as whole words; other scripts
    (e.g. Chinese) match as substrings.
    """
    if placeholders:
        phrase = re.sub(r"\([^)]*\)", " ", phrase)
    words = phrase.split()
    if not words:
        return None
    parts = []
    for w in words:
        if placeholders and re.fullmatch(r"X\W*", w):
            parts.append(r"\S*" + re.escape(w[1:]))
        else:
            parts.append(re.escape(w))
    text = " ".join(words)
    pre = r"(?<!\w)" if text[0].isascii() and text[0].isalnum() else ""
    post = r"(?!\w)" if text[-1].isascii() and text[-1].isalnum() else ""
    return re.compile(pre + r"\s+".join(parts) + post, re.I)


def avoid_phrases(
    state: AgentState, kb: KnowledgeBase, cause_card_id: str | None = None
) -> list[tuple[str, str, list[str]]]:
    """(phrase, source, suggested wording) for the cards in play and the blame list."""
    out: list[tuple[str, str, list[str]]] = []
    for cid in dict.fromkeys([*state.hypotheses, *([cause_card_id] if cause_card_id else [])]):
        card = kb.events.get(cid)
        if card is None or card.wording is None:
            continue
        out += [
            (p, f"the {cid} card's avoid list", list(card.wording.use)) for p in card.wording.avoid
        ]
    out += [(p, "blame wording", []) for p in BLAME_PHRASES]
    return out


def check_wording(
    fields: Sequence[tuple[str, str]], phrases: Sequence[tuple[str, str, list[str]]]
) -> list[str]:
    """Avoid-list phrases and blame patterns, one problem per field and phrase."""
    problems: list[str] = []
    compiled = [(p, src, use, _phrase_re(p)) for p, src, use in phrases]
    for name, text in fields:
        seen: set[str] = set()
        for phrase, src, use, rx in compiled:
            key = phrase.casefold()
            if rx is None or key in seen or not rx.search(text):
                continue
            seen.add(key)
            tip = f" Use wording like: {'; '.join(use[:3])}." if use else f" ({_BLAME_HELP})"
            problems.append(f"{name}: avoid '{phrase}' ({src}).{tip}")
        for rx in _BLAME_RES:
            m = next((m for m in rx.finditer(text) if not _hedged(text, m.start())), None)
            if m:
                problems.append(f"{name}: '{m.group(0)}' says who did it; {_BLAME_HELP}.")
                break
    return problems


def check_output_safety(fields: Sequence[tuple[str, str]]) -> list[str]:
    """No links, nothing that looks like a key, no instruction-like text (B3.5, B8 layer 7)."""
    problems: list[str] = []
    for name, text in fields:
        if _LINK_RE.search(text):
            problems.append(f"{name}: no links in answers.")
        if _SECRET_RE.search(text):
            problems.append(f"{name}: remove the long code-like string (looks like a key or id).")
        if instruction_like(text):
            problems.append(f"{name}: remove the instruction-like text.")
    return problems


# --- Memory ---------------------------------------------------------------------------------------

MEMORY_MIN_CHARS = 4


def public_text(state: AgentState, kb: KnowledgeBase, cause_card_id: str | None = None) -> str:
    """Text the answer may quote freely: cards in play and the place facts (not memory)."""
    parts = [d for cid in _card_ids(state, cause_card_id) if (d := _card_dump(kb, cid))]
    if state.place is not None:
        parts += [state.place.name or "", state.place.facts or ""]
    return "\n".join(parts)


def _memory_patterns(memory_values: Iterable[str], public: str) -> list[re.Pattern[str]]:
    pub = public.casefold()
    values = {" ".join(v.split()) for v in memory_values if isinstance(v, str)}
    out = []
    for v in sorted(values, key=len, reverse=True):
        if len(v) < MEMORY_MIN_CHARS or v.casefold() in pub:
            continue
        rx = _phrase_re(v, placeholders=False)
        if rx is not None:
            out.append(rx)
    return out


def leaks_memory(text: str, memory_values: Iterable[str], public: str = "") -> bool:
    """True when `text` repeats a remembered value (values also in `public` are exempt)."""
    return any(rx.search(text) for rx in _memory_patterns(memory_values, public))


def check_memory(
    fields: Sequence[tuple[str, str]], memory_values: Iterable[str], public: str = ""
) -> list[str]:
    """One problem per field that repeats a private memory value (the value is not echoed)."""
    patterns = _memory_patterns(memory_values, public)
    return [
        f"{name}: repeats something from the user's private place memory. Memory must never "
        "appear in answer text: say it in general words or leave it out."
        for name, text in fields
        if any(rx.search(text) for rx in patterns)
    ]


# --- Cause ----------------------------------------------------------------------------------------


def _get(obj: Any, name: str) -> Any:
    return obj.get(name) if isinstance(obj, Mapping) else getattr(obj, name, None)


def score_verdict(scoring: Any, card_id: str) -> str | None:
    """The scoring verdict for a card (`supported`, `contradicted`, ...), from
    `ScoreResult.verdicts` or its rows; None when scoring did not rate it."""
    if scoring is None:
        return None
    verdicts = _get(scoring, "verdicts")
    if isinstance(verdicts, Mapping) and verdicts.get(card_id) is not None:
        v = verdicts[card_id]
        return str(_get(v, "verdict") or v) if not isinstance(v, str) else v
    for row in _get(scoring, "rows") or []:
        rid = _get(row, "card_id") or _get(row, "hypothesis") or _get(row, "id")
        if rid == card_id:
            v = _get(row, "verdict")
            return str(v) if v is not None else None
    return None


def _ids(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, Mapping):
        return [k for k in value if isinstance(k, str)]
    if isinstance(value, list | tuple | set | frozenset):
        return [i for v in value for i in _ids(v)]
    return []


def _check_cause(args: FinishArgs, state: AgentState, kb: KnowledgeBase, scoring: Any) -> list[str]:
    cid = args.cause_card_id
    if not state.data_read:
        if cid or args.cause:
            return [
                "No data was read in this run, so no cause can be named: set cause and "
                "cause_card_id to null and explain in the sentence."
            ]
        return []
    if args.measure_only:
        if cid or args.cause:
            return [
                "measure_only answers name no cause: set cause and cause_card_id to null "
                "(the answer says the cause is unknown)."
            ]
        return []
    if not cid or not args.cause:
        return [
            "Name the cause in plain words (cause) and the event card behind it "
            "(cause_card_id), or set measure_only=true with cause and cause_card_id null."
        ]
    if cid not in kb.events:
        return [f"cause_card_id '{cid}' is not an event card."]
    problems: list[str] = []
    if cid not in state.hypotheses:
        problems.append(f"cause_card_id '{cid}' was never registered with register_hypotheses.")
    if cid not in state.cards_read:
        problems.append(f"Read the '{cid}' card with read_card before naming it as the cause.")
    if problems:
        return problems
    if scoring is None:
        return ["Scoring is not available for this run: answer measure-only (measure_only=true)."]
    verdict = score_verdict(scoring, cid)
    if verdict != "supported":
        supported = [h for h in state.hypotheses if score_verdict(scoring, h) == "supported"]
        alt = (
            f" Supported by the data: {', '.join(supported)}."
            if supported
            else " No registered card is supported: answer measure-only (measure_only=true)."
        )
        return [f"Code scoring marks '{cid}' as {verdict or 'not rated'}, not supported.{alt}"]
    tied = _ids(_get(scoring, "cannot_distinguish"))
    if cid in tied:
        rivals = ", ".join(r for r in tied if r != cid)
        return [
            f"Code scoring cannot tell '{cid}' apart from {rivals}, so no single cause can be "
            "named: answer measure-only (measure_only=true, cause and cause_card_id null) and "
            "say you can't tell between them (code adds what would settle it)."
        ]
    # `ScoreResult.cause_problem` is what `agent.answer.build_answer` applies: a cause it
    # would drop must be rejected here, never silently turned into a measure-only answer.
    check = getattr(scoring, "cause_problem", None)
    problem = check(cid) if callable(check) else None
    if problem:
        top = _get(scoring, "top")
        alt = f" Best supported: {top}." if isinstance(top, str) and top != cid else ""
        return [f"Code scoring does not allow '{cid}' as the cause: {problem}{alt}"]
    return []


#: Wording that asserts what caused a change ("filled in", "dumped", "to build housing").
_CAUSAL_RE = re.compile(
    r"\b(?:filled\s+(?:in|up)\b|filled\s+with\s+(?:soil|earth|rubble|sand|dirt|fill|concrete"
    r"|waste|debris|construction)|dump(?:ed|ing)\b|fly-?tipp(?:ed|ing)|bulldoz(?:ed|ing)\b"
    r"|reclaim(?:ed|ing)\b|reclamation\b|demolish(?:ed|ing)\b|deforest(?:ed|ation)\b"
    r"|built\s+(?:on|over|up\s+on|across)\b|to\s+build\b|for\s+(?:a\s+|new\s+)?(?:building"
    r"|construction|housing|development|a\s+road)\b|(?:building|construction)\s+site\b"
    r"|land\s+clearing\b|cleared\s+(?:for|to)\b)",
    re.I,
)
#: "was filled", "have been cleared": a statement that something was done at the place.
_PAST_CAUSE_RE = re.compile(
    r"\b(?:was|were|has\s+been|have\s+been|had\s+been|got|being)\s+(?:\w+ly\s+)?(?:filled"
    r"|dumped|built|cleared|drained|reclaimed|bulldozed|paved|developed|logged|burn(?:ed|t)"
    r"|demolished|excavated|levell?ed|flattened|deforested|cut\s+down)\b",
    re.I,
)
#: A clause that hedges ("can't tell whether ...", "no sign it was filled") names no cause.
_CAUSE_HEDGE_RE = re.compile(
    r"\b(?:whether|if|cannot|can\s+not|could\s+not|unclear|unknown|not|no|nor|never|neither"
    r"|without|unsure|uncertain|rule[sd]?\s+out|tell\s+apart|told\s+apart)\b|n't\b",
    re.I,
)
_CLAUSE_RE = re.compile(r"[^.;:!?]+")
_PAREN_RE = re.compile(r"\([^)]*\)")


def _clauses(text: str) -> list[str]:
    return [c for c in _CLAUSE_RE.findall(text) if c.strip()]


def _name_phrases(card: Any) -> list[str]:
    """A card's name (parenthesised notes dropped, "A / B" split) and a multi-word id
    ("pond_filling", "pond filling"). A part that is just a measure name ("Fire", "burn")
    is left out: measurements may be described in those words."""
    name = _PAREN_RE.sub(" ", card.name)
    parts = [p.strip() for p in name.split("/") if p.strip()]
    ids = [card.id, card.id.replace("_", " ")] if "_" in card.id else []
    return [p for p in dict.fromkeys([*parts, *ids]) if p.casefold() not in ALL_MEASURES]


def _phrase_hits(text: str, phrases: Iterable[str]) -> str | None:
    """The first phrase found in an unhedged clause of `text`, if any."""
    patterns = [rx for p in phrases if (rx := _phrase_re(p, placeholders=False)) is not None]
    for clause in _clauses(text):
        if _CAUSE_HEDGE_RE.search(clause):
            continue
        for rx in patterns:
            m = rx.search(clause)
            if m:
                return m.group(0)
    return None


def _regex_hit(text: str, rxs: Sequence[re.Pattern[str]]) -> str | None:
    for clause in _clauses(text):
        if _CAUSE_HEDGE_RE.search(clause):
            continue
        for rx in rxs:
            m = rx.search(clause)
            if m:
                return m.group(0)
    return None


def _own_wording(phrase: str, card: Any) -> bool:
    """True when `phrase` (another card's name or alias) is part of `card`'s own allowed
    wording: its name, an alias or a `wording.use` phrase. Using the supported card's own
    words ("consistent with new bare ground or a built surface") must never count as
    claiming another card's cause ("built" is also a construction alias)."""
    rx = _phrase_re(phrase, placeholders=False)
    if rx is None:
        return False
    allowed = [card.name, *card.aliases, *(card.wording.use if card.wording else [])]
    allowed += [card.id, card.id.replace("_", " ")]
    return any(rx.search(text) for text in allowed)


def _headline_fields(args: FinishArgs) -> list[tuple[str, str]]:
    out = [("title", args.title), ("sentence", args.sentence)]
    return [*out, ("todo", args.todo)] if args.todo else out


def check_cause_wording(args: FinishArgs, state: AgentState, kb: KnowledgeBase) -> list[str]:
    """No cause stated outside a supported cause, and a named cause that matches its card.

    - No data read, at a place: the title, sentence and todo may not say what was done there
      ("the pond was filled in").
    - Measure-only: they may not name an event card or use causal wording ("filled in",
      "dumped", "for a building site") unless the clause hedges ("can't tell whether ...").
    - A named cause must use its card's wording (a `wording.use` phrase, its name or an
      alias) and may not name another event card.
    """
    problems: list[str] = []
    if not state.data_read:
        if state.place is None:
            return []
        for name, text in _headline_fields(args):
            hit = _regex_hit(text, [_PAST_CAUSE_RE])
            if hit:
                problems.append(
                    f"{name}: '{hit}' says what happened at this place, but no data was read in "
                    "this run: explain in general terms, or read the data first."
                )
        return problems
    if args.measure_only:
        names = [p for card in kb.events.values() for p in _name_phrases(card)]
        for name, text in _headline_fields(args):
            hit = _regex_hit(text, [_CAUSAL_RE, _PAST_CAUSE_RE]) or _phrase_hits(text, names)
            if hit:
                problems.append(
                    f"{name}: '{hit}' names a cause, but this answer is measure-only: describe "
                    "only what was measured, or say you can't tell whether it happened."
                )
        return problems
    card = kb.events.get(args.cause_card_id or "")
    if card is None or not args.cause:
        return problems
    own = [*_name_phrases(card), *card.aliases]
    use = list(card.wording.use) if card.wording else []
    if not any(
        (rx := _phrase_re(p, placeholders=placeholders)) is not None and rx.search(args.cause)
        for p, placeholders in [*((u, True) for u in use), *((o, False) for o in own)]
    ):
        examples = "; ".join((use or own)[:3])
        problems.append(
            f"cause: describe the '{card.id}' cause with its card's wording, e.g. {examples}."
        )
    for other in kb.events.values():
        if other.id == card.id:
            continue
        phrases = [p for p in [*_name_phrases(other), *other.aliases] if not _own_wording(p, card)]
        hit = _phrase_hits(args.cause, phrases)
        if hit:
            problems.append(
                f"cause: '{hit}' describes {other.name.lower()} ({other.id}), which is not the "
                f"supported cause; describe only {card.id}."
            )
            break
    return problems


# --- Shape ----------------------------------------------------------------------------------------


def _too_long(name: str, text: str, limit: int) -> list[str]:
    return (
        [f"{name} is {len(text)} characters; keep it under {limit}."] if len(text) > limit else []
    )


def _check_shape(args: FinishArgs, state: AgentState) -> list[str]:
    problems: list[str] = []
    if not args.title:
        problems.append("title is empty.")
    if not args.sentence:
        problems.append("sentence is empty.")
    problems += _too_long("title", args.title, TITLE_MAX)
    problems += _too_long("sentence", args.sentence, SENTENCE_MAX)
    problems += _too_long("cause", args.cause or "", CAUSE_MAX)
    problems += _too_long("todo", args.todo or "", TODO_MAX)
    if len(args.stats) > STATS_MAX:
        problems.append(f"At most {STATS_MAX} stats.")
    for i, s in enumerate(args.stats):
        if not s.label or not s.value:
            problems.append(f"stats[{i}] needs a label and a value.")
        problems += _too_long(f"stats[{i}].label", s.label, STAT_LABEL_MAX)
        problems += _too_long(f"stats[{i}].value", s.value, STAT_VALUE_MAX)
    if len(args.caveats) > CAVEATS_MAX:
        problems.append(f"At most {CAVEATS_MAX} caveats.")
    for i, c in enumerate(args.caveats):
        problems += _too_long(f"caveats[{i}]", c, CAVEAT_MAX)
    if len(args.followups) > FOLLOWUPS_MAX:
        problems.append(f"At most {FOLLOWUPS_MAX} followups.")
    for i, f in enumerate(args.followups):
        problems += _too_long(f"followups[{i}]", f, FOLLOWUP_MAX)
    garbled = [name for name, text in finish_texts(args) if _CONTROL_RE.search(text)]
    if garbled:
        problems.append(
            f"{', '.join(garbled[:4])} contain(s) a line break or control character (garbled "
            "text?): rewrite each as one plain line, with plain words such as 'to' instead of "
            "arrows or dashes."
        )
    if state.data_read and not args.caveats:
        problems.append(
            "Place answers need caveats: say what the images cannot tell (see the cards' "
            "cannot_tell lists)."
        )
    if args.primary_block_id and args.primary_block_id not in {b.id for b in state.blocks}:
        known = ", ".join(b.id for b in state.blocks) or "none yet"
        problems.append(
            f"primary_block_id '{args.primary_block_id}' is not a block of this run "
            f"(blocks: {known})."
        )
    return problems


# --- Entry point ----------------------------------------------------------------------------------


def parse_finish(args: FinishArgs | Mapping[str, Any]) -> tuple[FinishArgs | None, list[str]]:
    """`args` as `FinishArgs`, or the problems that stop it from parsing."""
    if isinstance(args, FinishArgs):
        return args, []
    try:
        return FinishArgs.model_validate(dict(args)), []
    except ValidationError as exc:
        return None, [
            f"finish input {'.'.join(str(p) for p in e['loc']) or '(root)'}: {e['msg']}"
            for e in exc.errors()[:6]
        ]


def validate_finish(
    args: FinishArgs | Mapping[str, Any],
    state: AgentState,
    kb: KnowledgeBase,
    scoring: Any = None,
    *,
    extra_sources: Iterable[Any] = (),
) -> list[str]:
    """Every problem with a drafted answer (empty when it may be shown).

    `scoring` is the `ScoreResult` of `agent.scoring.score(state, kb)` (None when no data was
    read or scoring failed); `extra_sources` adds code-produced values to the number check
    (e.g. the run's full blocks and earth call summaries).
    """
    parsed, problems = parse_finish(args)
    if parsed is None:
        return problems
    fields = finish_texts(parsed)
    claims = [f for f in fields if not f[0].startswith("followups")]
    problems += _check_shape(parsed, state)
    cause_problems = _check_cause(parsed, state, kb, scoring)
    problems += cause_problems
    if not cause_problems:
        problems += check_cause_wording(parsed, state, kb)
    problems += check_numbers(claims, number_sources(state, kb, scoring, extra_sources))
    problems += check_wording(fields, avoid_phrases(state, kb, parsed.cause_card_id))
    problems += check_output_safety(fields)
    problems += check_memory(
        fields, state.memory_values, public_text(state, kb, parsed.cause_card_id)
    )
    return problems
