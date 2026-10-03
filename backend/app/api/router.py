from fastapi import APIRouter

from app.api.routes import (
    areas,
    dashboards,
    health,
    knowledge,
    layers,
    memory,
    places,
    runs,
    shares,
)

# One line per feature module. Add yours at the end of the list to avoid merge conflicts.
api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(runs.router)
api_router.include_router(layers.router)
api_router.include_router(areas.router)
api_router.include_router(knowledge.router)
api_router.include_router(places.router)
api_router.include_router(memory.router)
api_router.include_router(shares.router)
api_router.include_router(dashboards.router)
