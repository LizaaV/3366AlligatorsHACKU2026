"""Threads (BUILD-PLAN A4): conversations over the run store, and the follow-up board.

A thread is the runs that share a `thread_id` (the run store already groups them). This
module lists a user's threads, reloads one exactly, and builds the **board** a follow-up
starts from: the last finished agent run's answer, hypotheses, cards and measurements, so
"since when?" or "is that normal?" reuses the earlier work instead of starting over.

The board is code-built from stored state. Its strings (earlier answer text, questions) are
model or user text, so the loop shows it to the model as a labelled data block, never as
instructions; the earlier run's memory values carry over into the leak check.
"""

from __future__ import annotations

from typing import Any

from app.schemas.runs import RunRecord
from app.schemas.threads import ThreadDetail, ThreadSummary
from app.services import runs as run_store
from app.services.agent.state import AGENT_KEY, AgentState

#: A thread stops accepting new runs at this size (start a new conversation instead).
MAX_RUNS_PER_THREAD = 30
#: Most threads one listing returns.
MAX_LIST = 50
_TITLE = 120
_PRIVATE_KEYS = (AGENT_KEY, "agent_loop")  # agent state and loop flags: never in the API


def public(record: RunRecord) -> RunRecord:
    """The record as the API shows it: without the agent's private state."""
    if not any(k in record.params for k in _PRIVATE_KEYS):
        return record
    params = {k: v for k, v in record.params.items() if k not in _PRIVATE_KEYS}
    return record.model_copy(update={"params": params})


def _short(text: str, limit: int = _TITLE) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def owned_runs(user_id: str, thread_id: str) -> list[RunRecord] | None:
    """The thread's runs, oldest first, or None when it is unknown or not all the user's."""
    runs = run_store.list_runs(thread_id)
    if not runs or any(r.user_id != user_id for r in runs):
        return None
    return runs


def summarise(thread_id: str, runs: list[RunRecord]) -> ThreadSummary:
    first, last = runs[0], runs[-1]
    place = next((r.area.name for r in reversed(runs) if r.area and r.area.name), None)
    return ThreadSummary(
        thread_id=thread_id,
        title=_short(first.question),
        place_name=place,
        last_question=_short(last.question, 300),
        last_status=last.status,
        last_sentence=last.answer.sentence if last.answer else None,
        run_count=len(runs),
        started_at=first.created_at,
        updated_at=last.created_at,
    )


def list_threads(user_id: str, limit: int = 20) -> list[ThreadSummary]:
    """The user's conversations, most recent first (at most `MAX_LIST`)."""
    limit = max(1, min(limit, MAX_LIST))
    out: list[ThreadSummary] = []
    for thread_id, _ in run_store.list_threads(user_id)[:limit]:
        runs = owned_runs(user_id, thread_id)
        if runs:
            out.append(summarise(thread_id, runs))
    return out


def get_thread(user_id: str, thread_id: str) -> ThreadDetail | None:
    """One conversation to reload exactly, or None (unknown or not the user's)."""
    runs = owned_runs(user_id, thread_id)
    if runs is None:
        return None
    return ThreadDetail(thread_id=thread_id, runs=[public(r) for r in runs])


def previous_agent_run(runs: list[RunRecord]) -> tuple[RunRecord, AgentState] | None:
    """The latest finished agent run in the thread that read data or answered, with its state."""
    for record in reversed(runs):
        if record.status != "done" or record.answer is None:
            continue
        state = AgentState.load(record)
        if state is not None:
            return record, state
    return None


def board(record: RunRecord, state: AgentState) -> dict[str, Any]:
    """The compact summary a follow-up starts from (shown to the model as a data block)."""
    ans = record.answer
    rows = [
        {"hypothesis": r.hypothesis, "verdict": r.verdict, "observed": r.observed}
        for r in state.expectation_table
    ]
    dates = sorted({p.date.isoformat() for p in record.provenance})
    return {
        "earlier_question": record.question,
        "place": state.place.model_dump(mode="json") if state.place else None,
        "answer": (
            {
                "title": ans.title,
                "sentence": ans.sentence,
                "cause": ans.cause,
                "measure_only": ans.measure_only,
                "confidence": ans.confidence.model_dump(mode="json"),
                "stats": [s.model_dump(mode="json") for s in ans.stats],
            }
            if ans
            else None
        ),
        "hypotheses": rows,
        "cards_read": state.cards_read,
        "observed": state.findings.get("observed", {}),
        "blocks": [b.model_dump(mode="json") for b in state.blocks],
        "scene_dates": dates if len(dates) <= 6 else [*dates[:3], "…", *dates[-3:]],
        "scripts": [{"kind": s.kind, "skill_id": s.skill_id, "ok": s.ok} for s in state.scripts],
    }


def carry(prev: AgentState, new: AgentState, prev_run_id: str, prev_results: list[str]) -> None:
    """Seed a follow-up's state with the earlier run's work: hypotheses and cards carry over
    (no need to register again before data), measurements stay number sources, and the
    earlier memory values stay in the leak check. Budgets (turns, code runs) start fresh."""
    new.hypotheses = list(prev.hypotheses)
    new.post_hoc = list(prev.post_hoc)
    new.expectation_table = list(prev.expectation_table)
    new.cards_read = list(prev.cards_read)
    new.findings = dict(prev.findings)
    new.context_observed = dict(prev.context_observed)
    new.evidence = list(prev.evidence)
    new.notes = list(prev.notes)
    new.scripts = list(prev.scripts)
    new.memory_values = sorted({*prev.memory_values, *new.memory_values})
    if new.place is None:
        new.place = prev.place
    new.carried_from = prev_run_id
    new.carried_results = list(prev_results)
