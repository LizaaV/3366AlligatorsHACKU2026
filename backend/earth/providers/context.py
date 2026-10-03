"""Everything `describe()` needs about a place except satellite scenes (M2 adds those).

    parts = place_context(area)
    PlaceContext(name=parts.name, country=parts.country, area_ha=area.area_ha, ...,
                 land_cover=parts.land_cover, elevation_m=parts.elevation_m,
                 slope_deg=parts.slope_deg, rain_mm_30d=parts.rain_mm_30d,
                 warnings=parts.warnings + [...], recent_scenes=...)

Providers run in parallel; each failure degrades to None plus a warning, never an exception.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel

from earth.errors import EarthError
from earth.providers import nominatim, openmeteo, planetary
from earth.types import Area, Range, SlopeStats


class ContextParts(BaseModel):
    name: str | None = None
    country: str | None = None
    land_cover: dict[str, float] = {}
    elevation_m: Range | None = None
    slope_deg: SlopeStats | None = None
    rain_mm_30d: float | None = None
    warnings: list[str] = []


def _why(exc: Exception) -> str:
    return exc.message if isinstance(exc, EarthError) else f"{type(exc).__name__}: {exc}"


def place_context(area: Area) -> ContextParts:
    """Name, country, land cover, elevation, slope and 30-day rain for the area."""
    lat, lon = area.centroid()
    with ThreadPoolExecutor(max_workers=4, thread_name_prefix="ctx") as pool:
        futures = {
            "place": pool.submit(nominatim.reverse, lat, lon),
            "terrain": pool.submit(planetary.terrain, area),
            "land": pool.submit(planetary.worldcover, area),
            "rain": pool.submit(openmeteo.rain, area, "30d"),
        }
    parts = ContextParts(name=area.name)
    results: dict[str, object] = {}
    for key, fut in futures.items():
        try:
            results[key] = fut.result()
        except Exception as exc:  # noqa: BLE001 — any provider failure must degrade, not raise
            results[key] = None
            label = {
                "place": "Place name",
                "terrain": "Terrain",
                "land": "Land cover",
                "rain": "Rain",
            }[key]
            parts.warnings.append(f"{label} unavailable: {_why(exc)}")

    if hit := results["place"]:
        parts.name = area.name or hit.name
        parts.country = hit.country
    if t := results["terrain"]:
        parts.elevation_m, parts.slope_deg = t.elevation_m, t.slope_deg
    if lc := results["land"]:
        parts.land_cover = lc.shares
    if r := results["rain"]:
        parts.rain_mm_30d = r.total_mm
    return parts
