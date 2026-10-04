"""Chat projects: folders that group a user's conversations. Stored on the server, so they
survive a cleared browser and follow the user to another device."""

from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, Depends, HTTPException, Response

from app.schemas.projects import Project, ProjectCreate, ProjectUpdate
from app.schemas.runs import ID_PATTERN
from app.services import projects as store
from app.services.user import current_user

router = APIRouter(tags=["projects"])
_ID_RE = re.compile(ID_PATTERN)
_NOT_FOUND = {404: {"description": "Project not found (or not yours)."}}


def _id(value: str) -> str:
    if not _ID_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"Invalid project id: use {ID_PATTERN}.")
    return value


@router.get("/projects", response_model=list[Project], summary="List my chat projects")
async def list_projects(user_id: str = Depends(current_user)) -> list[Project]:
    """The user's projects, oldest first."""
    return await asyncio.to_thread(store.list_projects, user_id)


@router.post(
    "/projects",
    response_model=Project,
    status_code=201,
    summary="Create a chat project",
    responses={422: {"description": "Invalid name, or 50 projects already."}},
)
async def create_project(body: ProjectCreate, user_id: str = Depends(current_user)) -> Project:
    try:
        return await asyncio.to_thread(store.create_project, user_id, body.name)
    except store.LimitReached as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch(
    "/projects/{project_id}",
    response_model=Project,
    summary="Rename a chat project",
    responses=_NOT_FOUND,
)
async def rename_project(
    project_id: str, body: ProjectUpdate, user_id: str = Depends(current_user)
) -> Project:
    try:
        return await asyncio.to_thread(store.rename_project, user_id, _id(project_id), body.name)
    except store.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found.") from exc


@router.delete(
    "/projects/{project_id}",
    status_code=204,
    summary="Delete a chat project (its chats are kept, unfiled)",
    responses=_NOT_FOUND,
)
async def delete_project(project_id: str, user_id: str = Depends(current_user)) -> Response:
    try:
        await asyncio.to_thread(store.delete_project, user_id, _id(project_id))
    except store.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found.") from exc
    return Response(status_code=204)
