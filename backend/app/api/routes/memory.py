"""Memory is private: user-scoped, never part of anything shareable. The LLM never writes here."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path

from app.schemas.memory import (
    InsightCreate,
    InsightSaved,
    MeMemory,
    MemoryPatch,
    MePatch,
    PlaceMemory,
)
from app.services import memory
from app.services import places as place_svc
from app.services import runs as run_store
from app.services.memory import ID_RE
from app.services.user import current_user

router = APIRouter(tags=["memory"])
UserId = Annotated[str, Depends(current_user)]
RunId = Annotated[str, Path(pattern=ID_RE.pattern)]


def _place_memory(user_id: str, place_id: str) -> PlaceMemory:
    place = place_svc.get_place(user_id, place_id)
    if place is None:
        raise HTTPException(404, "place not found")
    mem = memory.get_place(user_id, place_id) or PlaceMemory(place_id=place_id)
    mem.title = place.name
    return mem


@router.get("/places/{place_id}/memory", response_model=PlaceMemory)
def get_place_memory(place_id: str, user_id: UserId) -> PlaceMemory:
    return _place_memory(user_id, place_id)


@router.patch("/places/{place_id}/memory", response_model=PlaceMemory)
def patch_place_memory(place_id: str, body: MemoryPatch, user_id: UserId) -> PlaceMemory:
    _place_memory(user_id, place_id)  # 404 if unknown
    try:
        if body.profile:
            memory.write_profile(user_id, place_id, body.profile)
        if body.note is not None:
            memory.add_note(user_id, place_id, body.note)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _place_memory(user_id, place_id)


@router.get("/me/memory", response_model=MeMemory)
def get_me_memory(user_id: UserId) -> MeMemory:
    return MeMemory(profile=memory.get_me(user_id))


@router.patch("/me/memory", response_model=MeMemory)
def patch_me_memory(body: MePatch, user_id: UserId) -> MeMemory:
    memory.write_me(user_id, body.profile)
    return MeMemory(profile=memory.get_me(user_id))


@router.post("/runs/{run_id}/insight", response_model=InsightSaved, status_code=201)
def save_run_insight(run_id: RunId, body: InsightCreate, user_id: UserId) -> InsightSaved:
    """Saves one insight to a place's memory. The run must be the caller's own; if the run
    names places, the insight's place must be one of them."""
    run = run_store.get_run(run_id)
    if run is None or run.user_id != user_id:
        raise HTTPException(404, "Run not found.")
    if run.place_ids and body.place_id not in run.place_ids:
        raise HTTPException(400, "place_id is not one of this run's places.")
    if place_svc.get_place(user_id, body.place_id) is None:
        raise HTTPException(404, "place not found")
    try:
        memory.save_insight(user_id, body.place_id, run_id, body.text, body.confidence)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return InsightSaved(run_id=run_id, place_id=body.place_id)
