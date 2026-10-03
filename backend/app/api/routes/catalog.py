"""Catalog: categories, satellites, skill modules, channels, languages, map layers (issue #41)."""

from fastapi import APIRouter

from app.schemas.catalog import CatalogDto
from app.services.catalog import get_catalog

router = APIRouter(tags=["catalog"])


@router.get("/catalog", response_model=CatalogDto)
def catalog() -> CatalogDto:
    """Registry data. Colours are presentation and stay in the frontend."""
    return get_catalog()
