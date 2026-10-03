"""Harness rules for the agent loop (ARCHITECTURE §4.0): the LLM requests, code grants.

Pure logic, no LLM and no I/O. The tool handlers (`agent.tools`) and the loop call these:

- `Limits`: the loop caps (turns, code runs, wall clock, asks, finish attempts, proposals).
- Cap checks with explicit reasons: `loop_cap` (end the loop; `CapHit.template_reason` is
  the reason for `agent.answer.build_template_answer`), `code_run_refusal`, `ask_refusal`,
  `budget_line` (a one-line budget reminder for the model).
- Hypotheses: `register_hypotheses` enforces hypotheses-before-data, marks late ones
  `post_hoc`, always adds `seasonal` and attaches look-alikes from the cards.
- Results: `compact` turns any value into JSON of at most `limit` characters (shrunk, then
  truncated with a note); `tool_ok` / `tool_error` wrap it in a `ToolResult`.
"""

from __future__ import annotations

import json
import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.core.config import settings
from app.schemas.stream import ExpectationRow
from app.services.agent.llm.base import ToolResult
from app.services.agent.scoring import expected_text
from app.services.agent.state import AgentState
from knowledge import ALL_MEASURES, EventCard, KnowledgeBase

__all__ = [
    "MAX_HYPOTHESES",
    "RESULT_CHARS",
    "SEASONAL",
    "TEMPLATE_REASONS",
    "TRUNCATED_NOTE",
    "CapHit",
    "CapKind",
    "Limits",
    "Registration",
    "ask_refusal",
    "budget_line",
    "card_row",
    "code_run_refusal",
    "compact",
    "data_seen",
    "elapsed_s",
    "loop_cap",
    "register_hypotheses",
    "time_left_s",
    "tool_error",
    "tool_ok",
]

#: The null hypothesis: always registered by code (normal seasonal change).
SEASONAL = "seasonal"
#: Most hypotheses a run may hold (model's own first, then `seasonal`, then look-alikes).
MAX_HYPOTHESES = 8
#: Default size cap of a tool result sent to the model, in characters.
RESULT_CHARS = 2000
TRUNCATED_NOTE = "shortened to fit; return fewer or smaller values to see more"

CapKind = Literal["turns", "code_runs", "wall_clock", "asks", "finish_attempts"]
#: `CapHit.kind` -> the `reason` of `agent.answer.build_template_answer`.
TEMPLATE_REASONS: dict[str, str] = {
    "turns": "turns",
    "code_runs": "code_runs",
    "wall_clock": "time",
    "finish_attempts": "finish_rejected",
}


# --- Limits and caps ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Limits:
    """Per-run caps (ARCHITECTURE §4.0 loop limits)."""

    max_turns: int = 12
    max_code_runs: int = 6
    wall_clock_s: float = 150.0
    max_asks: int = 2
    max_questions: int = 3
    max_finish_attempts: int = 3
    max_proposals: int = 3
    result_chars: int = RESULT_CHARS

    @classmethod
    def from_settings(cls) -> Limits:
        """Caps from `app.core.config.settings` (the rest are fixed by the design)."""
        return cls(
            max_turns=settings.agent_max_turns,
            max_code_runs=settings.agent_max_code_runs,
            wall_clock_s=settings.agent_wall_clock_s,
        )


@dataclass(frozen=True)
class CapHit:
    """A cap was reached. `reason` is plain words for the user (no numbers, safe to show in
    an answer); `detail` has the numbers, for the model and the logs."""

    kind: CapKind
    reason: str
    detail: str

    @property
    def template_reason(self) -> str:
        """The `reason` to pass to `agent.answer.build_template_answer`."""
        return TEMPLATE_REASONS.get(self.kind, "error")


def _now(now: datetime | None) -> datetime:
    return now if now is not None else datetime.now(UTC)


def elapsed_s(state: AgentState, now: datetime | None = None) -> float:
    """Seconds since `state.started_at` (reset it on resume so user think time is free)."""
    started = state.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=UTC)
    return max(0.0, (_now(now) - started).total_seconds())


def time_left_s(state: AgentState, limits: Limits, now: datetime | None = None) -> float:
    """Seconds left on the run's wall clock (never negative)."""
    return max(0.0, limits.wall_clock_s - elapsed_s(state, now))


def loop_cap(state: AgentState, limits: Limits, now: datetime | None = None) -> CapHit | None:
    """The cap that ends the loop now, if any: turns, wall clock or finish attempts.

    The loop then ends with a code-built, measure-only answer (never a dead run).
    """
    if state.turns >= limits.max_turns:
        return CapHit(
            "turns",
            "The run used all the model turns it is allowed.",
            f"Turn limit reached ({state.turns} of {limits.max_turns}).",
        )
    if elapsed_s(state, now) >= limits.wall_clock_s:
        return CapHit(
            "wall_clock",
            "The run ran out of time.",
            f"Wall clock limit reached ({elapsed_s(state, now):.0f} s of "
            f"{limits.wall_clock_s:.0f} s).",
        )
    if state.finish_attempts >= limits.max_finish_attempts:
        return CapHit(
            "finish_attempts",
            "The drafted answer did not pass the checks in time.",
            f"Finish was rejected {state.finish_attempts} times "
            f"(max {limits.max_finish_attempts}).",
        )
    return None


def code_run_refusal(state: AgentState, limits: Limits, now: datetime | None = None) -> str | None:
    """Why `run_code` / `run_skill` may not run now, or None when it may."""
    if not state.hypotheses:
        return (
            "Call register_hypotheses before reading any data: list the event cards that "
            "could explain what the user asks about (use [] if none fits)."
        )
    if state.code_runs >= limits.max_code_runs:
        return (
            f"Code run limit reached ({state.code_runs} of {limits.max_code_runs}). "
            "Call finish with what you have."
        )
    if elapsed_s(state, now) >= limits.wall_clock_s:
        return "The run is out of time. Call finish with what you have."
    return None


def ask_refusal(state: AgentState, limits: Limits) -> str | None:
    """Why `ask_user` may not run now, or None when it may: the asks are used up, or this is
    the last model turn (no turn would be left to use the answer)."""
    if state.turns >= limits.max_turns:
        return (
            "No turn is left to use the user's answer: call finish now with what you have, "
            "and say what is uncertain in the caveats."
        )
    if state.asks >= limits.max_asks:
        return (
            f"You already asked the user {state.asks} times (max {limits.max_asks}). "
            "Continue with what you know and say what is uncertain in the caveats."
        )
    return None


def budget_line(state: AgentState, limits: Limits, now: datetime | None = None) -> str:
    """One line on what is left, for the model (e.g. appended to a tool result batch)."""
    turns = max(0, limits.max_turns - state.turns)
    runs = max(0, limits.max_code_runs - state.code_runs)
    secs = time_left_s(state, limits, now)
    line = (
        f"Budget left: {turns} of {limits.max_turns} turns, {runs} of "
        f"{limits.max_code_runs} code runs, about {secs:.0f} s."
    )
    if turns <= 2 or runs == 0 or secs < 30:
        line += " Call finish soon."
    return line


# --- Hypotheses -----------------------------------------------------------------------------------


def data_seen(state: AgentState) -> bool:
    """True once a script got past the scan (it may have read data).

    Stricter than `state.data_read`: a script rejected by the AST scan never ran, so a
    hypothesis registered after it is not `post_hoc`.
    """
    return any(s.ok or s.error is None or s.error.kind != "scan" for s in state.scripts)


def card_row(card: EventCard, extra: Mapping[str, str] | None = None) -> ExpectationRow:
    """The expectation row for a card: each measure's expected sign, from the card's signs
    (the same text as the preset and the scoring), plus `extra` measures the card lacks."""
    expected: dict[str, list[str]] = {}
    for sign in card.signs:
        expected.setdefault(sign.measure, []).append(expected_text(sign))
    row = {m: "; ".join(v) for m, v in expected.items()}
    for measure, text in (extra or {}).items():
        row.setdefault(measure, text)
    return ExpectationRow(hypothesis=card.id, expected=row)


@dataclass
class Registration:
    """What `register_hypotheses` did. When `rejected` is set nothing was registered."""

    added: list[str] = field(default_factory=list)
    rows: list[ExpectationRow] = field(default_factory=list)
    post_hoc: bool = False
    seasonal_added: bool = False
    lookalikes: dict[str, list[str]] = field(default_factory=dict)
    already: list[str] = field(default_factory=list)
    rejected: dict[str, str] = field(default_factory=dict)
    dropped: list[str] = field(default_factory=list)
    capped: list[str] = field(default_factory=list)


def _model_extras(
    table: Iterable[Mapping[str, Any]], dropped: list[str]
) -> dict[str, dict[str, str]]:
    """The model's expectation table as {card id: {measure: text}}; unknown measures dropped."""
    out: dict[str, dict[str, str]] = {}
    for row in table:
        hyp = str(row.get("hypothesis", "")).strip()
        for item in row.get("expected") or []:
            if not isinstance(item, Mapping):
                continue
            measure = str(item.get("measure", "")).strip()
            text = " ".join(str(item.get("expect", "")).split())[:120]
            if measure not in ALL_MEASURES:
                dropped.append(f"{hyp}: {measure or '(empty)'}")
            elif hyp and text:
                out.setdefault(hyp, {})[measure] = text
    return out


def register_hypotheses(
    state: AgentState,
    kb: KnowledgeBase,
    ids: Sequence[str],
    table: Iterable[Mapping[str, Any]] = (),
) -> Registration:
    """Register hypotheses on `state` under the harness rules.

    - Every id must be an event card, else nothing is registered (`rejected`), so the model
      can fix the call without losing its pre-registration.
    - `seasonal` is always added by code; the look-alikes of each event the model names
      (except `seasonal`, which looks like everything) are attached by code.
    - Anything added after data was seen (`data_seen`) is `post_hoc` (confidence capped Low).
    - Expectation rows come from the cards' signs (what scoring uses); the model's extra
      measures that the card lacks are kept on the row.
    """
    reg = Registration()
    wanted: list[str] = []
    for raw in ids:
        cid = str(raw).strip()
        if cid in wanted:
            continue
        if cid in kb.events:
            wanted.append(cid)
        elif cid in kb.settings:
            reg.rejected[cid] = "is a setting card; hypotheses are event cards"
        else:
            reg.rejected[cid] = "is not an event card id"
    if reg.rejected:
        return reg

    extras = _model_extras(table, reg.dropped)
    known = set(state.hypotheses)
    room = MAX_HYPOTHESES - len(known)

    def add(cid: str) -> bool:
        nonlocal room
        if cid in known or cid in reg.added:
            return False
        if room <= 0:
            reg.capped.append(cid)
            return False
        reg.added.append(cid)
        room -= 1
        return True

    for cid in wanted:
        if cid in known:
            reg.already.append(cid)
        else:
            add(cid)
    if SEASONAL in kb.events:
        reg.seasonal_added = add(SEASONAL)
    for cid in wanted:
        if cid == SEASONAL:
            continue
        attached = [c.id for c in kb.lookalikes(cid) if add(c.id)]
        if attached:
            reg.lookalikes[cid] = attached

    reg.post_hoc = bool(reg.added) and data_seen(state)
    reg.rows = [card_row(kb.events[cid], extras.get(cid)) for cid in reg.added]
    state.hypotheses.extend(reg.added)
    if reg.post_hoc:
        state.post_hoc.extend(reg.added)
    state.expectation_table.extend(reg.rows)
    return reg


# --- Compact results ------------------------------------------------------------------------------

_SHRINK_STEPS: tuple[tuple[int, int], ...] = (
    (400, 20),
    (200, 12),
    (120, 8),
    (60, 5),
    (30, 3),
    (16, 2),
)


def _clean(obj: Any) -> Any:
    """JSON-ready copy: floats rounded to 4 decimals, None values dropped from dicts."""
    if obj is None or isinstance(obj, bool | int | str):
        return obj
    if isinstance(obj, float):
        return round(obj, 4) if math.isfinite(obj) else str(obj)
    if isinstance(obj, BaseModel):
        return _clean(obj.model_dump(mode="json", by_alias=True))
    if isinstance(obj, Mapping):
        return {str(k): _clean(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list | tuple | set | frozenset):
        return [_clean(v) for v in obj]
    if isinstance(obj, date | datetime):
        return obj.isoformat()
    return str(obj)


def _shrink(obj: Any, max_str: int, max_items: int) -> Any:
    if isinstance(obj, str):
        return obj if len(obj) <= max_str else obj[: max_str - 1] + "…"
    if isinstance(obj, list):
        out = [_shrink(v, max_str, max_items) for v in obj[:max_items]]
        if len(obj) > max_items:
            out.append(f"+{len(obj) - max_items} more")
        return out
    if isinstance(obj, dict):
        keys = list(obj)[: max_items * 2]
        out_d = {k: _shrink(obj[k], max_str, max_items) for k in keys}
        if len(obj) > len(keys):
            out_d["_more_keys"] = len(obj) - len(keys)
        return out_d
    return obj


def _dump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _fit_by_priority(data: dict[str, Any], limit: int) -> str | None:
    """`data` shrunk to fit, the last keys first (they matter least).

    Pass 1 shrinks each value moderately, from the last key to the first; pass 2 shrinks
    each value hard, again from the last key, and drops it (listed under `_dropped`) when
    that is not enough. The first key is never dropped. None when nothing fits.
    """
    work = dict(data)
    keys = list(data)
    dropped: list[str] = []

    def attempt() -> str | None:
        extra: dict[str, Any] = {"_truncated": TRUNCATED_NOTE}
        if dropped:
            extra["_dropped"] = list(reversed(dropped))
        text = _dump({**work, **extra})
        return text if len(text) <= limit else None

    passes = (_SHRINK_STEPS[:3], _SHRINK_STEPS[3:])
    for n, steps in enumerate(passes):
        for key in reversed(keys):
            for max_str, max_items in steps:
                work[key] = _shrink(data[key], max_str, max_items)
                if text := attempt():
                    return text
            if n == len(passes) - 1 and key != keys[0]:
                del work[key]
                dropped.append(key)
                if text := attempt():
                    return text
    return None


def compact(obj: Any, limit: int = RESULT_CHARS) -> str:
    """`obj` as compact JSON of at most `limit` characters.

    Too long: a `_truncated` note is added and, for an object, the values of the LAST keys
    are shrunk first (long strings cut, lists and objects shortened), then dropped (named in
    `_dropped`): put the most important keys first. Other values are shrunk evenly; if even
    that does not fit, a valid JSON object with a `preview` of the start is returned.
    """
    data = _clean(obj)
    text = _dump(data)
    if len(text) <= limit:
        return text
    if isinstance(data, dict) and data:
        fitted = _fit_by_priority(data, limit)
        if fitted is not None:
            return fitted
    for max_str, max_items in _SHRINK_STEPS:
        small = _shrink(data, max_str, max_items)
        wrapped = (
            {**small, "_truncated": TRUNCATED_NOTE}
            if isinstance(small, dict)
            else {"_truncated": TRUNCATED_NOTE, "data": small}
        )
        text = _dump(wrapped)
        if len(text) <= limit:
            return text
    raw = _dump(data)
    n = max(0, limit - 80)
    while True:
        text = _dump({"_truncated": TRUNCATED_NOTE, "preview": raw[:n]})
        if len(text) <= limit or n == 0:
            return text[:limit] if n == 0 else text
        n = max(0, n - (len(text) - limit) - 8)


def tool_ok(call_id: str, payload: Any, limit: int = RESULT_CHARS) -> ToolResult:
    """A successful tool result: `payload` as compact JSON."""
    return ToolResult(call_id=call_id, content=compact(payload, limit))


def tool_error(
    call_id: str, message: str, *, hint: str | None = None, limit: int = RESULT_CHARS, **extra: Any
) -> ToolResult:
    """A tool error the model can act on: `{"error": message, "hint": hint, ...extra}`."""
    payload: dict[str, Any] = {"error": message}
    if hint:
        payload["hint"] = hint
    payload.update(extra)
    return ToolResult(call_id=call_id, content=compact(payload, limit), is_error=True)
