"""Share links (BUILD-PLAN M6): a public snapshot of a run, with expiry and revoke."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import FileResponse

from app.api.routes.layers import _MEASURES
from app.api.routes.runs import _own_run
from app.schemas.shares import ShareCreated, SharedRun, ShareInfo
from app.services import shares as share_store
from app.services.user import current_user
from earth import settings as earth_settings
from earth.render import layer_path

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


@router.get(
    "/shares/{slug}/layers/{measure}/{scene}.png",
    response_class=FileResponse,
    summary="A layer image of a shared run (no login)",
    responses={
        200: {"content": {"image/png": {}}, "description": "The layer as a PNG."},
        400: {"description": "Invalid measure or scene id."},
        404: {"description": "Unknown link, or no such layer in that run."},
        410: {"description": "The link expired or was revoked."},
    },
)
def get_shared_layer(slug: str, measure: str, scene: str) -> FileResponse:
    """Map images inside a shared snapshot point here, so the run id is never public."""
    try:
        run_id = share_store.get_share_run_id(slug)
    except share_store.ShareGone as exc:
        raise HTTPException(
            status_code=410, detail="This link has expired or was revoked."
        ) from exc
    if run_id is None:
        raise HTTPException(status_code=404, detail="Share not found.")
    if measure not in _MEASURES:
        raise HTTPException(status_code=400, detail="Unknown measure.")
    try:
        path = layer_path(run_id, measure, scene)  # validates scene id
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid scene id.") from exc
    root = (earth_settings.data_dir() / "layers" / run_id).resolve()
    resolved = path.resolve()
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise HTTPException(status_code=404, detail="Layer not found.")
    return FileResponse(resolved, media_type="image/png")


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
