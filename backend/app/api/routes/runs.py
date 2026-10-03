"""Runs endpoints (BUILD-PLAN I5): start a run as a server-sent event stream, read it back,
and reply to clarification questions (which streams the rest of the run).

For now both streams serve the preset run (`app.services.preset_run`); the agent loop (A3)
plugs in behind the same contract. Threads (`GET /api/threads...`) belong to A4.
"""

from __future__ import annotations

import asyncio
import re
import typing
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette import EventSourceResponse

import earth
from app.schemas.runs import ID_PATTERN, ReplyRequest, RunRecord, RunRequest
from app.schemas.stream import StreamEvent, to_sse
from app.services import memory
from app.services import runs as run_store
from app.services.preset_run import resume_preset_run, stream_preset_run
from app.services.user import current_user

router = APIRouter(tags=["runs"])

_ID_RE = re.compile(ID_PATTERN)
MAX_KEY = memory.MAX_KEY
MAX_VALUE = memory.MAX_VALUE


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


@router.post(
    "/runs",
    summary="Start a run (server-sent events)",
    response_class=EventSourceResponse,
    responses=_sse_responses(
        {
            400: {"description": "Invalid area, thread id or X-User-Id."},
            404: {"description": "Thread not found for this user."},
        }
    ),
)
async def start_run(req: RunRequest, user_id: str = Depends(current_user)) -> EventSourceResponse:
    """Stream a run: `run_started`, `guard`, `hypotheses_registered`, steps, blocks,
    `answer` (or `error`), and always `done` last. If the run needs the user it sends
    `clarification_needed` then `done{status: waiting_user}`; continue with `/reply`.

    `thread_id` must come from an earlier `run_started` for this user (404 otherwise)."""
    if req.area is not None:
        try:
            req.area.to_area()
        except earth.EarthError as exc:
            raise HTTPException(status_code=400, detail=exc.to_dict()) from exc
    if req.thread_id is not None:
        # Only server-issued threads: the user must already have runs there and nobody
        # else may. Owners never change, so this can't race with another user's insert.
        runs = run_store.list_runs(req.thread_id)
        if not runs or any(r.user_id != user_id for r in runs):
            raise HTTPException(status_code=404, detail="Thread not found.")
    return EventSourceResponse(_sse(stream_preset_run(req, user_id)))


@router.get("/runs/{run_id}", response_model=RunRecord, summary="Read a stored run")
def get_run(run_id: str, user_id: str = Depends(current_user)) -> RunRecord:
    """The full stored run (answer, blocks, steps and the event log for replay)."""
    return _own_run(run_id, user_id)


@router.post(
    "/runs/{run_id}/reply",
    summary="Answer a run's clarification questions and stream the rest (server-sent events)",
    response_class=EventSourceResponse,
    responses=_sse_responses(
        {
            400: {"description": "Invalid run id, answers or X-User-Id."},
            404: {"description": "Run not found for this user."},
            409: {"description": "The run is not waiting for the user."},
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
    return EventSourceResponse(_sse(resume_preset_run(record, answered)))
