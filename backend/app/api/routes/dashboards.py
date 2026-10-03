"""Dashboards (BUILD-PLAN M8): save blocks, refresh them by re-running their script (no LLM)."""

from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, Depends, HTTPException, Response

from app.api.routes.runs import _own_run
from app.schemas.dashboards import (
    DashboardBlockOut,
    DashboardCreate,
    DashboardOut,
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


@router.post(
    "/dashboards", response_model=DashboardOut, status_code=201, summary="Create a dashboard"
)
def create_dashboard(body: DashboardCreate, user_id: str = Depends(current_user)) -> DashboardOut:
    try:
        return DashboardOut.of(store.create_dashboard(user_id, body.name))
    except store.LimitReached as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get(
    "/dashboards/{dashboard_id}",
    response_model=DashboardOut,
    summary="Read a dashboard with its blocks",
    responses={404: {"description": "Dashboard not found (or not yours)."}},
)
async def get_dashboard(dashboard_id: str, user_id: str = Depends(current_user)) -> DashboardOut:
    try:
        dash = await asyncio.to_thread(
            store.get_dashboard, _id(dashboard_id, "dashboard id"), user_id
        )
        return DashboardOut.of(dash)
    except store.DashboardNotFound as exc:
        raise _not_found("Dashboard") from exc


@router.patch(
    "/dashboards/{dashboard_id}",
    response_model=DashboardOut,
    summary="Rename a dashboard",
    responses={404: {"description": "Dashboard not found (or not yours)."}},
)
def rename_dashboard(
    dashboard_id: str, body: DashboardUpdate, user_id: str = Depends(current_user)
) -> DashboardOut:
    try:
        return DashboardOut.of(
            store.rename_dashboard(_id(dashboard_id, "dashboard id"), user_id, body.name)
        )
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
    response_model=DashboardBlockOut,
    status_code=201,
    summary="Save a block of one of your runs to a dashboard",
    responses={
        404: {"description": "Dashboard, run or block not found (or not yours)."},
        422: {
            "description": "The run has no script (its blocks cannot be refreshed), or the "
            "dashboard already has 50 blocks."
        },
    },
)
def add_block(
    dashboard_id: str, body: SaveBlockRequest, user_id: str = Depends(current_user)
) -> DashboardBlockOut:
    """Copies the block, plus the run's script and params, onto the dashboard."""
    _id(dashboard_id, "dashboard id")
    run = _own_run(body.run_id, user_id)
    try:
        return DashboardBlockOut.of(store.add_block(dashboard_id, user_id, run, body.block_id))
    except store.DashboardNotFound as exc:
        raise _not_found("Dashboard") from exc
    except store.BlockNotFound as exc:
        raise _not_found("Block") from exc
    except (store.NoScript, store.LimitReached) as exc:
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
    response_model=DashboardBlockOut,
    summary="Refresh a saved block (re-runs its script, no LLM)",
    responses={
        404: {"description": "Dashboard or block not found (or not yours)."},
        409: {"description": "This block is already being refreshed."},
        422: {
            "description": "The saved script is no longer valid (`detail` = ScriptError: "
            "kind `scan` or `shape`), hit a data outcome (`earth_kind` such as "
            "`no_clear_scenes`), or no longer produces the saved block (type + title). "
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
) -> DashboardBlockOut:
    """Re-runs the saved script with the saved params moved forward (an `after` within a day of
    the original run's date becomes today; relative `last="60d"` and `years` already move
    forward; `before` stays fixed), then swaps in the re-run block with the same type and title
    (position among those) with a template caption. Never guesses: no such block gives 422."""
    try:
        return DashboardBlockOut.of(
            await store.refresh_block(_id(dashboard_id, "dashboard id"), user_id, block_id)
        )
    except store.DashboardNotFound as exc:
        raise _not_found("Dashboard") from exc
    except store.BlockNotFound as exc:
        raise _not_found("Block") from exc
    except store.NoMatchingBlock as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except store.RefreshInProgress as exc:
        raise HTTPException(status_code=409, detail="This block is already refreshing.") from exc
    except store.RefreshFailed as exc:
        err = exc.error
        # A bad script or a data outcome (no clear scenes, area too small) is a 422;
        # crash / budget / timeout stay 502.
        status = 422 if err.kind in ("scan", "shape") or err.earth_kind else 502
        raise HTTPException(
            status_code=status, detail=err.model_dump(exclude={"traceback_tail"})
        ) from exc
