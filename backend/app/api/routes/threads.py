"""Threads (BUILD-PLAN A4): list the user's conversations and reload one exactly."""

from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.schemas.projects import ThreadProjectUpdate
from app.schemas.runs import ID_PATTERN
from app.schemas.threads import ThreadDetail, ThreadSummary
from app.services import projects as project_store
from app.services import threads
from app.services.user import current_user

router = APIRouter(tags=["threads"])
_ID_RE = re.compile(ID_PATTERN)


@router.get("/threads", response_model=list[ThreadSummary], summary="List my conversations")
async def list_threads(
    limit: int = Query(20, ge=1, le=threads.MAX_LIST),
    user_id: str = Depends(current_user),
) -> list[ThreadSummary]:
    """The user's conversations, most recent first: title (first question), place, the
    latest question, status and answer line."""
    return await asyncio.to_thread(threads.list_threads, user_id, limit)


@router.get(
    "/threads/{thread_id}",
    response_model=ThreadDetail,
    summary="Reload one conversation",
    responses={400: {"description": "Invalid thread id."}, 404: {"description": "Not found."}},
)
async def get_thread(thread_id: str, user_id: str = Depends(current_user)) -> ThreadDetail:
    """Every run of the conversation, oldest first, with answers, blocks, steps and the
    event log, so the chat can be redrawn exactly. Private agent state is left out."""
    if not _ID_RE.fullmatch(thread_id):
        raise HTTPException(status_code=400, detail=f"Invalid thread id: use {ID_PATTERN}.")
    detail = await asyncio.to_thread(threads.get_thread, user_id, thread_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Thread not found.")
    return detail


@router.patch(
    "/threads/{thread_id}",
    response_model=ThreadSummary,
    summary="File a conversation in a project (or unfile it)",
    responses={
        400: {"description": "Invalid thread or project id."},
        404: {"description": "Thread or project not found."},
    },
)
async def patch_thread(
    thread_id: str, body: ThreadProjectUpdate, user_id: str = Depends(current_user)
) -> ThreadSummary:
    """Move the conversation into a project, or out of it with `project_id: null`."""
    if not _ID_RE.fullmatch(thread_id):
        raise HTTPException(status_code=400, detail=f"Invalid thread id: use {ID_PATTERN}.")
    if body.project_id is not None and not _ID_RE.fullmatch(body.project_id):
        raise HTTPException(status_code=400, detail=f"Invalid project id: use {ID_PATTERN}.")
    try:
        summary = await asyncio.to_thread(threads.set_project, user_id, thread_id, body.project_id)
    except project_store.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found.") from exc
    if summary is None:
        raise HTTPException(status_code=404, detail="Thread not found.")
    return summary


@router.delete(
    "/threads/{thread_id}",
    status_code=204,
    summary="Delete a conversation",
    responses={400: {"description": "Invalid thread id."}, 404: {"description": "Not found."}},
)
async def delete_thread(thread_id: str, user_id: str = Depends(current_user)) -> Response:
    """Remove the conversation from the user's chats and its project, for good. Share links
    already sent keep working, and its runs still count towards the daily spend limit."""
    if not _ID_RE.fullmatch(thread_id):
        raise HTTPException(status_code=400, detail=f"Invalid thread id: use {ID_PATTERN}.")
    if not await asyncio.to_thread(threads.delete_thread, user_id, thread_id):
        raise HTTPException(status_code=404, detail="Thread not found.")
    return Response(status_code=204)
