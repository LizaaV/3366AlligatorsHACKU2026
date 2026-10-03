from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Response

from app.schemas.places import CreatePlaceRequest, PatchPlaceRequest, PlaceDto
from app.services import places as svc
from app.services.memory import ID_RE
from app.services.user import current_user
from earth.errors import EarthError

router = APIRouter(tags=["places"])
UserId = Annotated[str, Depends(current_user)]
PlaceId = Annotated[str, Path(pattern=ID_RE.pattern)]
_BAD_AREA = {400: {"description": "Unusable outline: `{kind, message, hint}`"}}
_NOT_FOUND = {404: {"description": "No such place for this user"}}


def _missing() -> HTTPException:
    return HTTPException(404, "place not found")


@router.get("/places", response_model=list[PlaceDto])
def list_places(user_id: UserId) -> list[PlaceDto]:
    return svc.list_places(user_id)


@router.post("/places", response_model=PlaceDto, status_code=201, responses=_BAD_AREA)
def create_place(body: CreatePlaceRequest, user_id: UserId) -> PlaceDto:
    try:
        return svc.create_place(user_id, body)
    except EarthError as exc:
        raise HTTPException(400, detail=exc.to_dict()) from exc


@router.get("/places/{place_id}", response_model=PlaceDto, responses=_NOT_FOUND)
def get_place(place_id: PlaceId, user_id: UserId) -> PlaceDto:
    place = svc.get_place(user_id, place_id)
    if place is None:
        raise _missing()
    return place


@router.patch("/places/{place_id}", response_model=PlaceDto, responses={**_BAD_AREA, **_NOT_FOUND})
def patch_place(place_id: PlaceId, body: PatchPlaceRequest, user_id: UserId) -> PlaceDto:
    try:
        place = svc.update_place(user_id, place_id, body)
    except EarthError as exc:
        raise HTTPException(400, detail=exc.to_dict()) from exc
    if place is None:
        raise _missing()
    return place


@router.delete("/places/{place_id}", status_code=204, responses=_NOT_FOUND)
def delete_place(place_id: PlaceId, user_id: UserId) -> Response:
    if not svc.delete_place(user_id, place_id):
        raise _missing()
    return Response(status_code=204)
