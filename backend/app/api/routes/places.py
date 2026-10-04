from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Path, Response, UploadFile

from app.schemas.places import (
    CreatePlaceRequest,
    DetectBoundaryRequest,
    DetectBoundaryResponse,
    ParseFileResponse,
    PatchPlaceRequest,
    PlaceDto,
)
from app.services import boundary, place_files, views
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
        created = svc.create_place(user_id, body)
    except EarthError as exc:
        raise HTTPException(400, detail=exc.to_dict()) from exc
    # Render its photo, greenness, water and bare-ground views for every recent pass now, in
    # the background, so looking at the place later is instant.
    views.prefetch_place(created.id, created.geometry, created.name)
    return created


@router.post("/places/detect-boundary", response_model=DetectBoundaryResponse)
def detect_boundary(body: DetectBoundaryRequest) -> DetectBoundaryResponse:
    """Suggest the outline of the field / pond / plot around a point (add-place wizard).

    Grown from the latest clear Sentinel-2 scene; a ~1 ha square with `confidence: "Low"` when
    there is no usable imagery. Never an error for imagery problems.
    """
    return boundary.detect_boundary(body.lat, body.lon)


_FILE_ERRORS = {
    413: {"description": "File too large or too many points: `{kind, message, hint}`"},
    415: {"description": "Unsupported type (e.g. Shapefile): `{kind, message, hint}`"},
    422: {"description": "Unreadable file or no outline in it: `{kind, message, hint}`"},
}


@router.post("/places/parse-file", response_model=ParseFileResponse, responses=_FILE_ERRORS)
def parse_file(file: Annotated[UploadFile, File(description="GeoJSON, KML/KMZ, GPX or CSV")]):
    """Read one outline from an uploaded boundary file (multipart field `file`, max 5 MB)."""
    data = file.file.read(place_files.MAX_BYTES + 1)
    try:
        return place_files.parse_boundary_file(file.filename or "", data)
    except place_files.FileProblem as exc:
        raise HTTPException(exc.status, detail=exc.detail()) from exc


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
    if body.geometry is not None or body.center is not None:  # a new outline renders afresh
        views.prefetch_place(place.id, place.geometry, place.name)
    return place


@router.delete("/places/{place_id}", status_code=204, responses=_NOT_FOUND)
def delete_place(place_id: PlaceId, user_id: UserId) -> Response:
    if not svc.delete_place(user_id, place_id):
        raise _missing()
    return Response(status_code=204)
