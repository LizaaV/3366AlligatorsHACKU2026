"""Skills library, manifest, builder and test (issue #41)."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from app.schemas.catalog import Tier
from app.schemas.skills import (
    CreateSkillRequest,
    NotAvailableResponse,
    SkillDto,
    SkillManifest,
    SkillTestRequest,
    SkillTestResult,
)
from app.services import skills as svc
from app.services.user import current_user

router = APIRouter(tags=["skills"])
UserId = Annotated[str, Depends(current_user)]
SkillId = Annotated[str, Path(pattern=svc.SKILL_ID_RE.pattern)]
_NOT_FOUND = {404: {"description": "No such skill (or not visible to this user)"}}


def _missing() -> HTTPException:
    return HTTPException(404, "skill not found")


@router.get("/skills", response_model=list[SkillDto])
def list_skills(
    user_id: UserId,
    category: Annotated[str | None, Query(max_length=40, description="A category key.")] = None,
    tier: Tier | None = None,
    q: Annotated[
        str | None, Query(max_length=200, description="Matches name, short text, publisher.")
    ] = None,
) -> list[SkillDto]:
    """Built-in skills first (implemented ones, then concepts), then user-made drafts."""
    return svc.list_skills(user_id, category=category, tier=tier, q=q)


@router.post("/skills", response_model=SkillDto, status_code=201)
def create_skill(body: CreateSkillRequest, user_id: UserId) -> SkillDto:
    """Save a skill from the builder. 422 when a module or category is not in the catalog."""
    try:
        return svc.create_skill(user_id, body)
    except svc.SkillValidationError as exc:
        raise HTTPException(422, detail=exc.errors) from exc


@router.post(
    "/skills/test",
    response_model=SkillTestResult,
    responses={
        200: {"description": "Planned shape. Not returned yet: the endpoint answers 501."},
        501: {
            "model": NotAvailableResponse,
            "description": "Testing a draft is not available yet.",
        },
    },
)
def test_skill(body: SkillTestRequest, user_id: UserId) -> SkillTestResult:
    """Dry-run a draft recipe against a saved place. **Not available yet: always 501** after
    validating the body (422 for unknown modules).

    Draft skills are module recipes and nothing turns a recipe into `earth` calls yet, so any
    "scenes usable" number here would be invented. When a recipe executor lands, this returns
    `SkillTestResult` with real `ProofScene`s and `Provenance`.
    """
    try:
        svc.check_steps(body.steps)
    except svc.SkillValidationError as exc:
        raise HTTPException(422, detail=exc.errors) from exc
    raise HTTPException(
        501,
        detail={
            "kind": "not_implemented",
            "message": "Testing a draft skill is not available yet.",
            "hint": "Save the skill and ask about the place instead; draft recipes cannot run "
            "until the module executor exists.",
        },
    )


@router.get("/skills/{skill_id}", response_model=SkillDto, responses=_NOT_FOUND)
def get_skill(skill_id: SkillId, user_id: UserId) -> SkillDto:
    skill = svc.get_skill(user_id, skill_id)
    if skill is None:
        raise _missing()
    return skill


@router.get("/skills/{skill_id}/manifest", response_model=SkillManifest, responses=_NOT_FOUND)
def get_manifest(skill_id: SkillId, user_id: UserId) -> SkillManifest:
    """The reproducible recipe: ordered modules with params, plus `code_ref` / `code_sha256`
    for skills that have a script (the same `code_ref` a run reports in `Answer.method`)."""
    manifest = svc.get_manifest(user_id, skill_id)
    if manifest is None:
        raise _missing()
    return manifest
