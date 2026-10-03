from fastapi import APIRouter

from app.api.routes import (
    areas,
    dashboards,
    health,
    knowledge,
    layers,
    me_skills,
    memory,
    places,
    projects,
    reports,
    runs,
    shares,
    threads,
    watches,
)
from app.api.routes import catalog as catalog_routes
from app.api.routes import satellites as satellites_routes
from app.api.routes import skills as skills_routes

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
api_router.include_router(reports.router)
api_router.include_router(watches.router)
api_router.include_router(skills_routes.router)
api_router.include_router(catalog_routes.router)
api_router.include_router(threads.router)
api_router.include_router(satellites_routes.router)
api_router.include_router(projects.router)
api_router.include_router(me_skills.router)
