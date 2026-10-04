"""Live views (look before asking): recent passes and rendered bands for a place or a spot."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from app.schemas.views import Band, Period, PrefetchResult, ViewImage, ViewPass
from app.services import places, views
from app.services.user import current_user

router = APIRouter(tags=["views"])

_ERRORS = {
    400: {"description": "Give either `place_id`, or both `lat` and `lon`."},
    404: {"description": "Unknown place, or no imagery here (offline data or no clear pass)."},
}


def _target(
    lat: float | None = Query(None, ge=-85, le=85),
    lon: float | None = Query(None, ge=-180, le=180),
    place_id: str | None = Query(None, max_length=64, description="A saved place: its outline."),
    user_id: str = Depends(current_user),
) -> views.Target:
    """A saved place (its own outline) or a dropped pin (a 2 km square around it)."""
    if place_id is not None:
        if lat is not None or lon is not None:
            raise HTTPException(
                status_code=400, detail="Give either place_id or lat/lon, not both."
            )
        p = places.get_place(user_id, place_id)
        if p is None:
            raise HTTPException(status_code=404, detail="Place not found.")
        return views.place(p.id, p.geometry, p.name)
    if lat is None or lon is None:
        raise HTTPException(status_code=400, detail="Give either place_id, or both lat and lon.")
    return views.spot(lat, lon)


ViewTarget = Annotated[views.Target, Depends(_target)]
PeriodQ = Annotated[
    Period,
    Query(
        description="How far back: `4m` (the latest clear passes, default), or `1y`, `2y`, `5y` "
        "(the clearest pass of each month)."
    ),
]


def _unavailable(exc: views.ViewUnavailable) -> HTTPException:
    return HTTPException(status_code=404, detail=str(exc))


@router.get(
    "/views/passes",
    response_model=list[ViewPass],
    summary="Recent clear passes over a place or spot",
    responses=_ERRORS,
)
def view_passes(target: ViewTarget, period: PeriodQ = "4m") -> list[ViewPass]:
    """Clear Sentinel-2 passes over the place (or the square around the pin) in the period."""
    try:
        found = views.recent_scenes(target, period)
    except views.ViewUnavailable as exc:
        raise _unavailable(exc) from exc
    return [
        ViewPass(
            scene=s.id, date=s.date, satellite=s.satellite, cloud=round(s.cloud_over_area * 100)
        )
        for s in found
    ]


@router.get(
    "/views",
    response_model=ViewImage,
    summary="Render one band of a place or spot",
    responses=_ERRORS,
)
def view_image(
    band: Band,
    target: ViewTarget,
    scene: str | None = Query(None, max_length=80),
    period: PeriodQ = "4m",
) -> ViewImage:
    """One band (photo, greenness, water, bare) from the given pass or the latest clear one.
    A place is drawn inside its own outline (transparent outside); a pin gets a 2 km square.
    Rendered once, then cached. No agent, no cost."""
    try:
        return ViewImage(**views.render_view(target, band, scene, period))
    except views.ViewUnavailable as exc:
        raise _unavailable(exc) from exc


@router.post(
    "/views/prefetch",
    response_model=PrefetchResult,
    status_code=202,
    summary="Render every band of every pass ahead of time",
    responses=_ERRORS,
)
def view_prefetch(target: ViewTarget, period: PeriodQ = "4m") -> PrefetchResult:
    """Queue rendering of photo, greenness, water and bare ground for every clear pass in the
    period, so flicking through dates is instant. Runs in the background; a place's recent
    window is already queued when it is saved."""
    try:
        passes = len(views.recent_scenes(target, period))
    except views.ViewUnavailable as exc:
        raise _unavailable(exc) from exc
    queued = views.prefetch(target, period)
    return PrefetchResult(passes=passes, images=passes * len(views.BANDS), queued=queued)
