"""`/api/areas/*`: turn user input into an area, and describe an area (BUILD-PLAN I5)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

import earth
from app.schemas.areas import AreaInput, AreaResolveRequest, AreaResolveResponse
from app.services import areas as service

router = APIRouter(prefix="/areas", tags=["areas"])

_ERRORS = {
    422: {"description": "Unusable area: detail is {kind, message, hint}."},
}


def _unprocessable(exc: earth.EarthError) -> HTTPException:
    return HTTPException(422, detail=exc.to_dict())


@router.post(
    "/resolve",
    response_model=AreaResolveResponse,
    responses={**_ERRORS, 501: {"description": "Place search not available yet."}},
)
def resolve_area(req: AreaResolveRequest) -> AreaResolveResponse:
    """A search text, point, outline or map link → an area, plus how it was found."""
    try:
        return service.resolve(req)
    except earth.EarthError as exc:
        raise _unprocessable(exc) from exc
    except service.SearchUnavailable as exc:
        raise HTTPException(status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc


@router.post("/context", response_model=earth.PlaceContext, responses=_ERRORS)
def area_context(body: AreaInput) -> earth.PlaceContext:
    """Size, land cover, terrain, rain and recent scene counts for an area."""
    try:
        return service.describe(body.to_area())
    except earth.EarthError as exc:
        raise _unprocessable(exc) from exc
