"""PDF reports (BUILD-PLAN M7): download a run, or a shared run, as a PDF."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response

from app.api.routes.runs import _own_run
from app.services import report as report_service
from app.services import shares as share_store
from app.services.user import current_user

router = APIRouter(tags=["reports"])

_PDF = {"application/pdf": {}}


def _pdf(content: bytes, short: str) -> Response:
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="constellation-{short}.pdf"'},
    )


@router.get(
    "/runs/{run_id}/report.pdf",
    response_class=Response,
    summary="Download a run as a PDF report",
    responses={
        200: {"content": _PDF, "description": "The report (A4 PDF)."},
        400: {"description": "Invalid run id or X-User-Id."},
        404: {"description": "Run not found (or not yours)."},
        409: {"description": "The run is not finished yet."},
    },
)
def get_run_report(run_id: str, user_id: str = Depends(current_user)) -> Response:
    """Same content as a share link (answer, blocks, provenance, method); no memory or ids."""
    run = _own_run(run_id, user_id)
    if run.status != "done":
        raise HTTPException(status_code=409, detail=f"Run is {run.status}; finish it first.")
    now = datetime.now(UTC)
    shared = share_store.snapshot(run, "report", now, now)
    return _pdf(report_service.render_report(shared, run.run_id), run.run_id)


@router.get(
    "/shares/{slug}/report.pdf",
    response_class=Response,
    summary="Download a shared run as a PDF (no login)",
    responses={
        200: {"content": _PDF, "description": "The report (A4 PDF)."},
        404: {"description": "Unknown link."},
        410: {"description": "The link expired or was revoked."},
    },
)
def get_shared_report(slug: str) -> Response:
    """The PDF of the snapshot behind a share link, for its viewers."""
    try:
        run_id = share_store.get_share_run_id(slug)
        shared = share_store.get_shared_run(slug)
    except share_store.ShareGone as exc:
        raise HTTPException(
            status_code=410, detail="This link has expired or was revoked."
        ) from exc
    if run_id is None or shared is None:
        raise HTTPException(status_code=404, detail="Share not found.")
    return _pdf(report_service.render_report(shared, run_id), slug[:8])
