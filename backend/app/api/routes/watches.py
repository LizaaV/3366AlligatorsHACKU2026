from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Response

from app.schemas.watches import (
    CreateWatchRequest,
    FeasibilityDto,
    FeasibilityRequest,
    PatchWatchRequest,
    WatchDto,
    WatchProofDto,
)
from app.services import places
from app.services import watches as svc
from app.services.memory import ID_RE
from app.services.user import current_user

router = APIRouter(tags=["watches"])
UserId = Annotated[str, Depends(current_user)]
WatchId = Annotated[str, Path(pattern=ID_RE.pattern)]
_NOT_FOUND = {404: {"description": "No such watch for this user"}}
_NO_PLACE = {404: {"description": "`place_id` is not one of this user's places"}}


def _missing() -> HTTPException:
    return HTTPException(404, "watch not found")


def _place_area(user_id: str, place_id: str | None) -> float | None:
    """404 when `place_id` is given but unknown, like `/api/places/{id}`."""
    if place_id is None:
        return None
    place = places.get_place(user_id, place_id)
    if place is None:
        raise HTTPException(404, "place not found")
    return place.area_ha


@router.get("/watches", response_model=list[WatchDto])
def list_watches(user_id: UserId) -> list[WatchDto]:
    return svc.list_watches(user_id)


@router.post(
    "/watches",
    response_model=WatchDto,
    status_code=201,
    responses={
        **_NO_PLACE,
        422: {
            "description": "Invalid body, a refused question (`detail` is a `FeasibilityDto`), "
            "or too many watches"
        },
    },
)
def create_watch(body: CreateWatchRequest, user_id: UserId) -> WatchDto:
    area_ha = _place_area(user_id, body.place_id)
    try:
        return svc.create_watch(user_id, body, area_ha)
    except svc.NotWatchable as exc:
        raise HTTPException(422, detail=exc.result.model_dump()) from exc
    except svc.LimitReached as exc:
        raise HTTPException(422, detail=str(exc)) from exc


@router.post("/watches/feasibility", response_model=FeasibilityDto, responses=_NO_PLACE)
def check_feasibility(body: FeasibilityRequest, user_id: UserId) -> FeasibilityDto:
    return svc.feasibility(body.text, _place_area(user_id, body.place_id))


@router.patch("/watches/{watch_id}", response_model=WatchDto, responses=_NOT_FOUND)
def patch_watch(watch_id: WatchId, body: PatchWatchRequest, user_id: UserId) -> WatchDto:
    watch = svc.update_watch(user_id, watch_id, body)
    if watch is None:
        raise _missing()
    return watch


@router.delete("/watches/{watch_id}", status_code=204, responses=_NOT_FOUND)
def delete_watch(watch_id: WatchId, user_id: UserId) -> Response:
    if not svc.delete_watch(user_id, watch_id):
        raise _missing()
    return Response(status_code=204)


@router.get("/watches/{watch_id}/proof", response_model=WatchProofDto, responses=_NOT_FOUND)
def get_proof(watch_id: WatchId, user_id: UserId) -> WatchProofDto:
    proof = svc.get_proof(user_id, watch_id)
    if proof is None:
        raise _missing()
    return proof
