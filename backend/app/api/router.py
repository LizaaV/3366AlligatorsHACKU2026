from fastapi import APIRouter

from app.api.routes import health

# One line per feature module. Add yours at the end of the list to avoid merge conflicts.
api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
