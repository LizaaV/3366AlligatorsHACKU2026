"""Runs endpoints (BUILD-PLAN I5): start a run as a server-sent event stream, read it back,
and reply to clarification questions (which streams the rest of the run).

A new run goes to the agent loop (`app.services.agent.loop`, A3) when an LLM provider is
configured; otherwise (no provider, `AGENT_MODE=preset`, or the daily spend cap reached) it
serves the scripted preset run (`app.services.preset_run`) only when the request is about
the preset's place (no place given, or the Hoo Hok Wai outline); a request for another
place gets an honest `error` (kind `agent_unavailable` or `spend_cap`) and `done{failed}`,
never the demo answer for the wrong place. Both use the same stream contract. Threads
(`GET /api/threads...`) belong to A4.
"""

from __future__ import annotations

import asyncio
import logging
import math
import re
import typing
from collections.abc import AsyncIterator
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette import EventSourceResponse

import earth
from app.core.config import settings
from app.schemas.areas import AreaInput
from app.schemas.runs import ID_PATTERN, ReplyRequest, RunRecord, RunRequest
from app.schemas.stream import StreamEvent, to_sse
from app.services import memory, places
from app.services import runs as run_store
from app.services.agent import llm, policy
from app.services.agent.loop import (
    LOOP_KEY,
    lookup_place,
    resume_agent_run,
    stream_agent_run,
    stream_unavailable,
)
from app.services.agent.state import AGENT_KEY
from app.services.preset_run import resume_preset_run, stream_preset_run
from app.services.user import current_user
from earth.presets import HOO_HOK_WAI

router = APIRouter(tags=["runs"])
log = logging.getLogger(__name__)

_ID_RE = re.compile(ID_PATTERN)
MAX_KEY = memory.MAX_KEY
MAX_VALUE = memory.MAX_VALUE
#: Share of overlap (intersection over union) that makes an outline the preset's place.
PRESET_OVERLAP = 0.5
_NO_AGENT = "Live analysis is not available on this server right now; only the demo place works."


def _event_names() -> list[str]:
    union = typing.get_args(StreamEvent)[0]
    return [m.__name__ for m in typing.get_args(union)]


def _stream_schema() -> dict:
    """`oneOf` the StreamEvent members; their components come from `RunRecord.events`."""
    union = typing.get_args(StreamEvent)[0]
    refs = {
        m.model_fields["event"].default: f"#/components/schemas/{m.__name__}"
        for m in typing.get_args(union)
    }
    return {
        "oneOf": [{"$ref": r} for r in refs.values()],
        "discriminator": {"propertyName": "event", "mapping": refs},
    }


def _sse_responses(extra: dict[int, dict]) -> dict[int | str, dict]:
    return {
        200: {
            "description": "Server-sent events, one StreamEvent per message; `done` is last.",
            "content": {"text/event-stream": {"schema": _stream_schema()}},
        },
        **extra,
    }


async def _sse(events: AsyncIterator[StreamEvent]) -> AsyncIterator[dict[str, str]]:
    async for ev in events:
        yield to_sse(ev)


def _check_id(value: str, what: str) -> str:
    if not _ID_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"Invalid {what}: use {ID_PATTERN}.")
    return value


def _own_run(run_id: str, user_id: str) -> RunRecord:
    _check_id(run_id, "run id")
    record = run_store.get_run(run_id)
    if record is None or record.user_id != user_id:
        raise HTTPException(status_code=404, detail="Run not found.")
    return record


def _public(record: RunRecord) -> RunRecord:
    """The record as the API shows it: without the agent's private state (the transcript
    with the provider's raw payload, and the remembered values kept for the leak check)."""
    private = (AGENT_KEY, LOOP_KEY)
    if not any(k in record.params for k in private):
        return record
    params = {k: v for k, v in record.params.items() if k not in private}
    return record.model_copy(update={"params": params})


def _usable(provider: llm.LLMProvider) -> bool:
    """False for the scripted test provider with nothing scripted (never a real agent)."""
    remaining = getattr(provider, "remaining", None)
    return not (provider.name == "fake" and remaining == (0, 0))


@dataclass(frozen=True)
class _NoAgent:
    """Why a request cannot get an agent run: `kind` and `message` for the `error` event."""

    kind: str
    message: str


def _agent_provider(req: RunRequest) -> llm.LLMProvider | _NoAgent:
    """The provider for an agent run, or why there is none (reason logged).

    Raises 400 when the request names a provider that is not configured.
    """
    if req.provider is not None and req.provider not in llm.available_providers():
        raise HTTPException(
            status_code=400, detail=f"The {req.provider} provider is not configured here."
        )
    if settings.agent_mode == "preset":
        log.info("no agent run: AGENT_MODE is preset")
        return _NoAgent("agent_unavailable", _NO_AGENT)
    try:
        provider = llm.get_provider(req.provider)
    except llm.ProviderUnavailable as exc:
        if req.provider is not None:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        log.info("no agent run: no LLM provider (%s)", exc)
        return _NoAgent("agent_unavailable", _NO_AGENT)
    if not _usable(provider):
        log.info("no agent run: the fake provider has nothing scripted")
        return _NoAgent("agent_unavailable", _NO_AGENT)
    try:
        policy.check_spend_cap()
    except policy.SpendCapReached as exc:
        log.warning("no agent run: the daily spend cap is reached")
        return _NoAgent(exc.code, exc.message)
    return provider


def _is_preset_place(area: earth.Area) -> bool:
    """True when `area` is (mostly) the preset's outline (Hoo Hok Wai)."""
    try:
        a, b = area.geometry(), HOO_HOK_WAI.geometry()
        union = a.union(b).area
        return union > 0 and a.intersection(b).area / union >= PRESET_OVERLAP
    except Exception:  # noqa: BLE001 — a geometry that cannot be compared is not the preset
        return False


def _preset_fits(req: RunRequest, user_id: str) -> bool:
    """The scripted preset answers this request truthfully: it names no place, or its place
    (outline or saved place) is the preset's. Anything else must never get the demo answer."""
    if req.area is None and not req.place_id:
        return True
    area = req.area.to_area() if req.area is not None else lookup_place(user_id, req.place_id)
    return area is not None and _is_preset_place(area)


@router.post(
    "/runs",
    summary="Start a run (server-sent events)",
    response_class=EventSourceResponse,
    responses=_sse_responses(
        {
            400: {"description": "Invalid area, thread id or X-User-Id, or unknown provider."},
            404: {"description": "Thread not found for this user."},
            429: {"description": "Too many runs: wait `Retry-After` seconds."},
        }
    ),
)
async def start_run(req: RunRequest, user_id: str = Depends(current_user)) -> EventSourceResponse:
    """Stream a run: `run_started`, `guard`, `hypotheses_registered`, steps, blocks,
    `answer` (or `error`), and always `done` last. If the run needs the user it sends
    `clarification_needed` then `done{status: waiting_user}`; continue with `/reply`.

    `thread_id` must come from an earlier `run_started` for this user (404 otherwise).
    Agent runs are rate-limited per user and by the number running at once (429 with
    `Retry-After`). Without a configured LLM provider, or once the daily spend cap is
    reached, the preset run is served for the preset's place only; any other place gets an
    `error` (kind `agent_unavailable` or `spend_cap`) and `done{status: failed}`."""
    if req.area is not None:
        try:
            req.area.to_area()
        except earth.EarthError as exc:
            raise HTTPException(status_code=400, detail=exc.to_dict()) from exc
    if req.area is None and req.place_id is not None:
        # A saved place: run on its outline, never silently on the demo preset.
        place = await asyncio.to_thread(places.get_place, user_id, req.place_id)
        if place is None:
            raise HTTPException(status_code=404, detail="Place not found.")
        req = req.model_copy(update={"area": AreaInput(geojson=place.geometry, name=place.name)})
    if req.thread_id is not None:
        # Only server-issued threads: the user must already have runs there and nobody
        # else may. Owners never change, so this can't race with another user's insert.
        runs = run_store.list_runs(req.thread_id)
        if not runs or any(r.user_id != user_id for r in runs):
            raise HTTPException(status_code=404, detail="Thread not found.")
    provider = await asyncio.to_thread(_agent_provider, req)
    if isinstance(provider, _NoAgent):
        if await asyncio.to_thread(_preset_fits, req, user_id):
            return EventSourceResponse(_sse(stream_preset_run(req, user_id)))
        events = stream_unavailable(req, user_id, kind=provider.kind, message=provider.message)
        return EventSourceResponse(_sse(events))
    try:
        policy.check_run_slots()
        policy.check_cooldown(user_id)
    except (policy.TooManyRuns, policy.CooldownActive) as exc:
        raise HTTPException(
            status_code=429,
            detail=exc.message,
            headers={"Retry-After": str(max(1, math.ceil(exc.retry_after)))},
        ) from exc
    return EventSourceResponse(_sse(stream_agent_run(req, user_id, provider)))


@router.get("/runs/{run_id}", response_model=RunRecord, summary="Read a stored run")
def get_run(run_id: str, user_id: str = Depends(current_user)) -> RunRecord:
    """The full stored run (answer, blocks, steps and the event log for replay)."""
    return _public(_own_run(run_id, user_id))


@router.post(
    "/runs/{run_id}/reply",
    summary="Answer a run's clarification questions and stream the rest (server-sent events)",
    response_class=EventSourceResponse,
    responses=_sse_responses(
        {
            400: {"description": "Invalid run id, answers or X-User-Id."},
            404: {"description": "Run not found for this user."},
            409: {"description": "The run is not waiting for the user."},
            429: {"description": "Too many runs streaming: wait `Retry-After` seconds."},
            503: {
                "description": "The run's LLM provider is not available right now, or the "
                "daily budget for analyses is used up."
            },
        }
    ),
)
async def reply(
    run_id: str, body: ReplyRequest, user_id: str = Depends(current_user)
) -> EventSourceResponse:
    """Accept the answers (only keys that were asked), save them to the place profile when
    `remember`, then stream the same run: `clarification_answered` first (also stored in
    the event log), then steps, blocks, `answer`, and `done` last."""
    record = await asyncio.to_thread(_own_run, run_id, user_id)
    if record.status != "waiting_user":
        raise HTTPException(status_code=409, detail=f"Run is {record.status}, not waiting_user.")
    if any(len(k) > MAX_KEY or len(v) > MAX_VALUE for k, v in body.answers.items()):
        raise HTTPException(
            status_code=400, detail=f"Keys up to {MAX_KEY} and answers up to {MAX_VALUE} chars."
        )
    provider: llm.LLMProvider | None = None
    if AGENT_KEY in record.params:
        # Resolved first: if the agent can't continue, nothing about the run changes.
        try:
            provider = llm.get_provider(record.provider or settings.llm_provider)
        except llm.ProviderUnavailable as exc:
            raise HTTPException(
                status_code=503, detail="The agent is not available right now; try later."
            ) from exc
        try:
            await asyncio.to_thread(policy.check_spend_cap)
        except policy.SpendCapReached as exc:
            raise HTTPException(status_code=503, detail=exc.message) from exc
        try:
            policy.check_run_slots()
        except policy.TooManyRuns as exc:
            raise HTTPException(
                status_code=429,
                detail=exc.message,
                headers={"Retry-After": str(max(1, math.ceil(exc.retry_after)))},
            ) from exc
    asked = run_store.asked_keys(record)
    accepted = {k: v for k, v in body.answers.items() if not asked or k in asked}
    # Memory first: if it refuses, nothing about the run has changed yet.
    remember = body.remember and bool(accepted) and bool(record.place_ids)
    if remember:
        try:
            await asyncio.to_thread(memory.write_profile, user_id, record.place_ids[0], accepted)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"Could not remember: {exc}") from exc
    try:
        record, answered = await asyncio.to_thread(
            run_store.apply_reply, run_id, user_id, body.answers, remember
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Run not found.") from exc
    except run_store.RunStateError as exc:  # another reply got there first
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if provider is not None:
        return EventSourceResponse(_sse(resume_agent_run(record, answered, provider)))
    return EventSourceResponse(_sse(resume_preset_run(record, answered)))
