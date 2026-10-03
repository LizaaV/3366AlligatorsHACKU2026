"""Dashboards (BUILD-PLAN M8): save blocks, refresh them by re-running their script (no LLM)."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Response

from app.api.routes.runs import _own_run
from app.schemas.dashboards import (
    Dashboard,
    DashboardBlock,
    DashboardCreate,
    DashboardSummary,
    DashboardUpdate,
    SaveBlockRequest,
)
from app.schemas.runs import ID_PATTERN
from app.services import dashboards as store
from app.services.user import current_user

router = APIRouter(tags=["dashboards"])

_ID_RE = re.compile(ID_PATTERN)


def _id(value: str, what: str) -> str:
    if not _ID_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"Invalid {what}: use {ID_PATTERN}.")
    return value


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} not found.")


@router.get("/dashboards", response_model=list[DashboardSummary], summary="Your dashboards")
def list_dashboards(user_id: str = Depends(current_user)) -> list[DashboardSummary]:
    return store.list_dashboards(user_id)


@router.post("/dashboards", response_model=Dashboard, status_code=201, summary="Create a dashboard")
def create_dashboard(body: DashboardCreate, user_id: str = Depends(current_user)) -> Dashboard:
    return store.create_dashboard(user_id, body.name)


@router.get(
    "/dashboards/{dashboard_id}",
    response_model=Dashboard,
    summary="Read a dashboard with its blocks",
    responses={404: {"description": "Dashboard not found (or not yours)."}},
)
def get_dashboard(dashboard_id: str, user_id: str = Depends(current_user)) -> Dashboard:
    try:
        return store.get_dashboard(_id(dashboard_id, "dashboard id"), user_id)
    except store.DashboardNotFound as exc:
        raise _not_found("Dashboard") from exc


@router.patch(
    "/dashboards/{dashboard_id}",
    response_model=Dashboard,
    summary="Rename a dashboard",
    responses={404: {"description": "Dashboard not found (or not yours)."}},
)
def rename_dashboard(
    dashboard_id: str, body: DashboardUpdate, user_id: str = Depends(current_user)
) -> Dashboard:
    try:
        return store.rename_dashboard(_id(dashboard_id, "dashboard id"), user_id, body.name)
    except store.DashboardNotFound as exc:
        raise _not_found("Dashboard") from exc


@router.delete(
    "/dashboards/{dashboard_id}",
    status_code=204,
    summary="Delete a dashboard",
    responses={404: {"description": "Dashboard not found (or not yours)."}},
)
def delete_dashboard(dashboard_id: str, user_id: str = Depends(current_user)) -> Response:
    try:
        store.delete_dashboard(_id(dashboard_id, "dashboard id"), user_id)
    except store.DashboardNotFound as exc:
        raise _not_found("Dashboard") from exc
    return Response(status_code=204)


@router.post(
    "/dashboards/{dashboard_id}/blocks",
    response_model=DashboardBlock,
    status_code=201,
    summary="Save a block of one of your runs to a dashboard",
    responses={
        404: {"description": "Dashboard, run or block not found (or not yours)."},
        422: {"description": "The run has no script, so its blocks cannot be refreshed."},
    },
)
def add_block(
    dashboard_id: str, body: SaveBlockRequest, user_id: str = Depends(current_user)
) -> DashboardBlock:
    """Copies the block, plus the run's script and params, onto the dashboard."""
    _id(dashboard_id, "dashboard id")
    run = _own_run(body.run_id, user_id)
    try:
        return store.add_block(dashboard_id, user_id, run, body.block_id)
    except store.DashboardNotFound as exc:
        raise _not_found("Dashboard") from exc
    except store.BlockNotFound as exc:
        raise _not_found("Block") from exc
    except store.NoScript as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete(
    "/dashboards/{dashboard_id}/blocks/{block_id}",
    status_code=204,
    summary="Remove a block from a dashboard",
    responses={404: {"description": "Dashboard or block not found (or not yours)."}},
)
def remove_block(
    dashboard_id: str, block_id: str, user_id: str = Depends(current_user)
) -> Response:
    try:
        store.remove_block(_id(dashboard_id, "dashboard id"), user_id, block_id)
    except store.DashboardNotFound as exc:
        raise _not_found("Dashboard") from exc
    except store.BlockNotFound as exc:
        raise _not_found("Block") from exc
    return Response(status_code=204)


@router.post(
    "/dashboards/{dashboard_id}/blocks/{block_id}/refresh",
    response_model=DashboardBlock,
    summary="Refresh a saved block (re-runs its script, no LLM)",
    responses={
        404: {"description": "Dashboard or block not found (or not yours)."},
        422: {
            "description": "The saved script is no longer valid (`detail` = ScriptError: "
            "kind `scan` or `shape`), or no longer produces a block like the saved one. "
            "The old block is kept."
        },
        502: {
            "description": "The script ran and failed (`detail` = ScriptError: kind `crash`, "
            "`budget` or `timeout`, with `earth_kind` and `hint`). The old block is kept."
        },
    },
)
async def refresh_block(
    dashboard_id: str, block_id: str, user_id: str = Depends(current_user)
) -> DashboardBlock:
    """Re-runs the saved script with the saved params moved forward (a fixed `after` equal to the
    original run's date becomes today; relative `last="60d"` and `years` already move forward;
    `before` stays fixed), then swaps in the new block of the same type with a template caption."""
    try:
        return await store.refresh_block(_id(dashboard_id, "dashboard id"), user_id, block_id)
    except store.DashboardNotFound as exc:
        raise _not_found("Dashboard") from exc
    except store.BlockNotFound as exc:
        raise _not_found("Block") from exc
    except store.NoMatchingBlock as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except store.RefreshFailed as exc:
        err = exc.error
        status = 422 if err.kind in ("scan", "shape") else 502
        raise HTTPException(
            status_code=status, detail=err.model_dump(exclude={"traceback_tail"})
        ) from exc
