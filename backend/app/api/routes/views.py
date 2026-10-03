"""Live views (look before asking): recent passes and rendered bands for any spot."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.schemas.views import Band, ViewImage, ViewPass
from app.services import views

router = APIRouter(tags=["views"])

Lat = Query(ge=-85, le=85)
Lon = Query(ge=-180, le=180)
_ERRORS = {404: {"description": "No imagery for this spot (offline data or no clear pass)."}}


def _unavailable(exc: views.ViewUnavailable) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/views/passes",
    response_model=list[ViewPass],
    summary="Recent clear passes over a spot",
    responses=_ERRORS,
)
def view_passes(lat: float = Lat, lon: float = Lon) -> list[ViewPass]:
    """The latest clear Sentinel-2 passes over a 2 km square around the point, newest first."""
    try:
        found = views.recent_scenes(lat, lon)
    except views.ViewUnavailable as exc:
        raise _unavailable(exc) from exc
    return [
        ViewPass(
            scene=s.id, date=s.date, satellite=s.satellite, cloud=round(s.cloud_over_area * 100)
        )
        for s in found
    ]


@router.get(
    "/views", response_model=ViewImage, summary="Render one band of a spot", responses=_ERRORS
)
def view_image(
    band: Band, lat: float = Lat, lon: float = Lon, scene: str | None = Query(None, max_length=80)
) -> ViewImage:
    """One band (photo, greenness, water, bare) of a 2 km square around the point, from the
    given pass or the latest clear one. Rendered once, then cached. No agent, no cost."""
    try:
        return ViewImage(**views.render_view(lat, lon, band, scene))
    except views.ViewUnavailable as exc:
        raise _unavailable(exc) from exc
