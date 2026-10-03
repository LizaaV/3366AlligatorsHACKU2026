"""The skills the current user installed. Stored on the server, so they follow the user."""

from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path

from app.schemas.me_skills import InstalledSkills
from app.services import me_skills as store
from app.services import skills as skills_svc
from app.services.user import current_user

router = APIRouter(tags=["skills"])
UserId = Annotated[str, Depends(current_user)]
SkillId = Annotated[str, Path(pattern=skills_svc.SKILL_ID_RE.pattern)]
_NOT_FOUND = {404: {"description": "No such skill (or not visible to this user)."}}


@router.get("/me/skills", response_model=InstalledSkills, summary="List my installed skills")
async def list_installed(user_id: UserId) -> InstalledSkills:
    return InstalledSkills(installed=await asyncio.to_thread(store.list_installed, user_id))


@router.put(
    "/me/skills/{skill_id}",
    response_model=InstalledSkills,
    summary="Install a skill",
    responses=_NOT_FOUND,
)
async def install_skill(skill_id: SkillId, user_id: UserId) -> InstalledSkills:
    """Idempotent. 404 when the skill is not in `GET /api/skills` for this user."""
    if await asyncio.to_thread(skills_svc.get_skill, user_id, skill_id) is None:
        raise HTTPException(404, "skill not found")
    return InstalledSkills(installed=await asyncio.to_thread(store.install, user_id, skill_id))


@router.delete("/me/skills/{skill_id}", response_model=InstalledSkills, summary="Uninstall a skill")
async def uninstall_skill(skill_id: SkillId, user_id: UserId) -> InstalledSkills:
    """Idempotent: uninstalling a skill that is not installed just returns the list."""
    return InstalledSkills(installed=await asyncio.to_thread(store.uninstall, user_id, skill_id))
