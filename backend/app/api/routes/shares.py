"""Share links (BUILD-PLAN M6): a public snapshot of a run, with expiry and revoke."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response

from app.api.routes.runs import _own_run
from app.schemas.shares import ShareCreated, SharedRun, ShareInfo
from app.services import shares as share_store
from app.services.user import current_user

router = APIRouter(tags=["shares"])


@router.post(
    "/runs/{run_id}/share",
    response_model=ShareCreated,
    status_code=201,
    summary="Share a run as a public link",
    responses={
        404: {"description": "Run not found (or not yours)."},
        409: {"description": "The run is not finished yet."},
    },
)
def create_share(run_id: str, user_id: str = Depends(current_user)) -> ShareCreated:
    """Snapshot the run behind an unguessable link that needs no login and expires."""
    run = _own_run(run_id, user_id)
    if run.status != "done":
        raise HTTPException(status_code=409, detail=f"Run is {run.status}; share finished runs.")
    return share_store.create_share(run)


@router.get(
    "/runs/{run_id}/shares",
    response_model=list[ShareInfo],
    summary="Your share links for a run",
    responses={404: {"description": "Run not found (or not yours)."}},
)
def list_shares(run_id: str, user_id: str = Depends(current_user)) -> list[ShareInfo]:
    _own_run(run_id, user_id)
    return share_store.list_shares(run_id, user_id)


@router.get(
    "/shares/{slug}",
    response_model=SharedRun,
    summary="Read a shared run (no login)",
    responses={
        404: {"description": "Unknown link."},
        410: {"description": "The link expired or was revoked."},
    },
)
def get_shared_run(slug: str) -> SharedRun:
    """The snapshot taken at share time: no user id, memory, event log or code."""
    try:
        shared = share_store.get_shared_run(slug)
    except share_store.ShareGone as exc:
        raise HTTPException(
            status_code=410, detail="This link has expired or was revoked."
        ) from exc
    if shared is None:
        raise HTTPException(status_code=404, detail="Share not found.")
    return shared


@router.delete(
    "/shares/{slug}",
    status_code=204,
    summary="Revoke a share link",
    responses={404: {"description": "Unknown link (or not yours)."}},
)
def revoke_share(slug: str, user_id: str = Depends(current_user)) -> Response:
    if not share_store.revoke_share(slug, user_id):
        raise HTTPException(status_code=404, detail="Share not found.")
    return Response(status_code=204)
