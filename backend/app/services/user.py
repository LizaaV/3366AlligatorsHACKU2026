"""The demo user (BUILD-PLAN I5): no accounts; "demo" unless `X-User-Id` says otherwise."""

from __future__ import annotations

import re

from fastapi import Header, HTTPException

from app.schemas.runs import USER_ID_PATTERN

DEMO_USER = "demo"
#: Leading [a-z0-9], like `memory.ID_RE`, so memory never rejects a user the API accepted.
USER_ID_RE = re.compile(USER_ID_PATTERN)


def current_user(
    x_user_id: str | None = Header(
        None, description=f'Optional demo user id (default "demo"), {USER_ID_PATTERN}.'
    ),
) -> str:
    """FastAPI dependency: the user id for this request; 400 if the header is malformed."""
    if x_user_id is None:
        return DEMO_USER
    if not USER_ID_RE.fullmatch(x_user_id):
        raise HTTPException(status_code=400, detail=f"Invalid X-User-Id: use {USER_ID_PATTERN}.")
    return x_user_id
