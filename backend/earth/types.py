"""Public types of the `earth` library (BUILD-PLAN I1).

Every public function returns one of these small models, never pixel arrays.
Pixels stay inside `earth`; callers hold a `LayerRef` id instead.
"""

from __future__ import annotations

import json
import math
from datetime import date
from typing import Literal

import shapely
from pydantic import BaseModel, Field, field_validator
from pyproj import CRS, Geod, Transformer
from shapely.geometry import Point, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, unary_union

from earth.errors import InvalidArea

Measure = Literal["greenness", "moisture", "water", "bare", "burn", "roughness", "heat"]
SceneKind = Literal["optical", "radar", "thermal"]

_GEOD = Geod(ellps="WGS84")
MAX_RADIUS_M = 50_000


class Provenance(BaseModel):
    """Where a number came from (HANDOFF B1.8). Attached to every result."""

    provider: str  # "earth_search_s2"
    satellite: str  # "Sentinel-2B"
    scene: str  # "S2B_49QHE_20260930_0_L2A", or "24 scenes" for a series
    date: date
    cloud_over_area: float  # 0–1, over the area, not the tile
    resolution_m: float
    method: str  # "NDVI, SCL mask [0,1,3,8,9,10], mean over 958 clean pixels"


def _check_coordinates(geom: BaseGeometry) -> None:
    """Every vertex inside lon [-180, 180] / lat [-90, 90]; no antimeridian crossing."""
    coords = shapely.get_coordinates(geom)
    if not len(coords):
        return
    xs, ys = coords[:, 0], coords[:, 1]
    if not (math.isfinite(float(xs.sum())) and math.isfinite(float(ys.sum()))):
        raise InvalidArea(
            "The outline has non-finite coordinates.", "Send real [lon, lat] numbers."
        )
    if (abs(xs) > 180).any() or (abs(ys) > 90).any():
        swapped = (abs(xs) <= 90).all() and (abs(ys) <= 180).all()
        hint = "Use lon in [-180, 180] and lat in [-90, 90]."
        if swapped:
            hint = "GeoJSON is [lon, lat]: did you swap them? " + hint
        raise InvalidArea("Coordinates are outside the valid range.", hint)
    if xs.max() - xs.min() > 180:
        raise InvalidArea(
            f"The outline spans {xs.max() - xs.min():.0f}° of longitude (antimeridian?).",
            "Split the outline at 180° into two polygons.",
        )


# --- Area ---------------------------------------------------------------------------------------


class Area(BaseModel):
    """A place outline in WGS84 (lon/lat GeoJSON geometry), with its true area in hectares."""

    geojson: dict
    area_ha: float
    name: str | None = None

    @field_validator("area_ha")
    @classmethod
    def _area_ha_positive(cls, v: float) -> float:
        if not math.isfinite(v) or v <= 0:
            raise InvalidArea(f"area_ha must be a positive number, got {v}", "Draw a real outline.")
        return v

    @classmethod
    def from_point(
        cls, lat: float, lon: float, radius_m: float = 400, name: str | None = None
    ) -> Area:
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise InvalidArea(
                f"Not a valid coordinate: {lat}, {lon}",
                "Use lat in [-90, 90] and lon in [-180, 180]: from_point(lat, lon).",
            )
        if not (math.isfinite(radius_m) and radius_m > 0):
            raise InvalidArea("radius_m must be positive", "Try radius_m=400.")
        if radius_m > MAX_RADIUS_M:
            raise InvalidArea(
                f"radius_m={radius_m:g} is above the {MAX_RADIUS_M} m limit.",
                "Use a smaller radius_m (400 is typical).",
            )
        local = CRS.from_proj4(f"+proj=aeqd +lat_0={lat} +lon_0={lon} +units=m +datum=WGS84")
        to_wgs84 = Transformer.from_crs(local, "EPSG:4326", always_xy=True).transform
        circle = transform(to_wgs84, Point(0, 0).buffer(radius_m, quad_segs=16))
        return cls._from_geometry(circle, name)

    @classmethod
    def from_geojson(cls, geojson: dict, name: str | None = None) -> Area:
        """Accepts a Polygon, MultiPolygon, Feature or FeatureCollection in lon/lat."""
        if not isinstance(geojson, dict):
            raise InvalidArea(
                f"Expected a GeoJSON object (dict), got {type(geojson).__name__}",
                "Send a GeoJSON Polygon: {'type': 'Polygon', 'coordinates': [[[lon, lat], ...]]}",
            )
        try:
            if geojson.get("type") == "FeatureCollection":
                geom = unary_union([shape(f["geometry"]) for f in geojson["features"]])
            elif geojson.get("type") == "Feature":
                geom = shape(geojson["geometry"])
                name = name or (geojson.get("properties") or {}).get("name")
            else:
                geom = shape(geojson)
        except Exception as exc:  # noqa: BLE001 — shapely raises many types
            raise InvalidArea(
                f"Could not read the outline: {exc}", "Send a GeoJSON Polygon."
            ) from exc
        if geom.geom_type not in ("Polygon", "MultiPolygon") or geom.is_empty:
            raise InvalidArea(
                f"The outline must be a polygon, got {geom.geom_type}",
                "Draw an outline, or use Area.from_point(lat, lon, radius_m).",
            )
        _check_coordinates(geom)
        try:
            if not geom.is_valid:
                geom = geom.buffer(0)
        except Exception as exc:  # noqa: BLE001 — GEOS errors
            raise InvalidArea(
                f"Could not repair the outline: {exc}", "Redraw the outline."
            ) from exc
        return cls._from_geometry(geom, name)

    @classmethod
    def _from_geometry(cls, geom: BaseGeometry, name: str | None) -> Area:
        try:
            area_m2 = abs(_GEOD.geometry_area_perimeter(geom)[0])
            geojson = json.loads(json.dumps(mapping(geom)))  # tuples → lists, as after a round trip
        except Exception as exc:  # noqa: BLE001 — shapely/GEOS/pyproj raise many types
            raise InvalidArea(
                f"Could not measure the outline: {exc}", "Redraw the outline."
            ) from exc
        area_ha = round(area_m2 / 10_000, 4)
        if not math.isfinite(area_ha) or area_ha <= 0:
            raise InvalidArea(
                "The outline has no area.", "Draw a closed outline with at least 3 distinct points."
            )
        return cls(geojson=geojson, area_ha=area_ha, name=name)

    # Helpers for earth internals (not fields, so they never reach the API).
    def geometry(self) -> BaseGeometry:
        return shape(self.geojson)

    def bbox(self) -> tuple[float, float, float, float]:
        """(west, south, east, north) in degrees."""
        return tuple(self.geometry().bounds)  # type: ignore[return-value]

    def centroid(self) -> tuple[float, float]:
        """(lat, lon)."""
        c = self.geometry().centroid
        return c.y, c.x

    def utm_epsg(self) -> int:
        lat, lon = self.centroid()
        zone = int((lon + 180) // 6) % 60 + 1
        return (32600 if lat >= 0 else 32700) + zone

    def pixels(self, resolution_m: float = 10) -> int:
        return int(self.area_ha * 10_000 / (resolution_m * resolution_m))

    def is_ring(self) -> bool:
        """True for the outline returned by `surroundings()` (a polygon with a hole)."""
        geom = self.geometry()
        polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
        return any(len(p.interiors) > 0 for p in polys)


# --- Results ------------------------------------------------------------------------------------


class Range(BaseModel):
    min: float
    max: float


class SlopeStats(BaseModel):
    mean: float
    p90: float


class SceneCounts(BaseModel):
    optical: int
    clear: int
    radar: int


class PlaceContext(BaseModel):
    """What `describe(area)` returns: enough to plan, without reading any satellite pixels twice."""

    name: str | None
    country: str | None
    area_ha: float
    pixels_10m: int
    land_cover: dict[str, float]  # ESA WorldCover class → share 0–1, e.g. {"trees": 0.62}
    elevation_m: Range | None
    slope_deg: SlopeStats | None
    rain_mm_30d: float | None  # Open-Meteo; NON-SATELLITE
    recent_scenes: SceneCounts
    warnings: list[str] = []


class Scene(BaseModel):
    id: str  # "S2B_49QHE_20260930_0_L2A"
    date: date
    satellite: str  # "Sentinel-2B"
    provider: str  # "earth_search_s2"
    kind: SceneKind
    cloud_over_area: float  # 0–1, computed over the area from the SCL band
    usable: bool  # cloud_over_area ≤ max_cloud and enough clean pixels
    resolution_m: float


class SceneList(BaseModel):
    scenes: list[Scene]  # newest first
    kind: SceneKind
    max_cloud: int  # percent, as requested

    def clear(self) -> list[Scene]:
        return [s for s in self.scenes if s.usable]

    def latest_clear(self) -> Scene:
        clear = self.clear()
        if not clear:
            from earth.errors import NoClearScenes

            raise NoClearScenes(
                f"0 of {len(self.scenes)} {self.kind} scenes clear over this area.",
                'Try kind="radar", a longer window (last="90d"), or a higher max_cloud.',
            )
        return clear[0]


class LayerRef(BaseModel):
    """A handle to pixels held by `earth`. Pass it to `index`, `measure`, `render`."""

    id: str  # "L3"
    scene: str
    date: date
    measure: Measure | None  # None = raw bands from `load`
    resolution_m: float
    provenance: Provenance


class Stats(BaseModel):
    mean: float
    median: float
    p10: float
    p90: float
    clean_px: int
    cloud: float  # 0–1 over the area
    provenance: Provenance


class SeriesPoint(BaseModel):
    date: date
    value: float
    scene: str
    clean_px: int


class BandMonth(BaseModel):
    """The normal range for a calendar month, from earlier years."""

    month: int = Field(ge=1, le=12)
    lo: float
    hi: float
    mean: float


class Series(BaseModel):
    measure: Measure
    points: list[SeriesPoint]  # oldest first, one clear scene per period
    band: list[BandMonth]
    provenance: Provenance  # summary: scene = "N scenes", date = last point


class Patch(BaseModel):
    ha: float
    centroid: tuple[float, float]  # (lat, lon)
    geojson: dict


class Comparison(BaseModel):
    measure: Measure
    before: Stats
    after: Stats
    delta: float  # after.mean − before.mean
    changed_ha: float
    patches: list[Patch]  # largest first
    provenance: Provenance  # of the `after` scene


class RenderedLayer(BaseModel):
    layer_id: str
    url: str  # "/api/layers/{run_id}/{measure}/{scene}.png"
    bounds: tuple[float, float, float, float]  # (west, south, east, north), WGS84
    measure: Measure | None
    scene: str
    date: date


class EarthCall(BaseModel):
    """One `earth` call, as logged for the UI (BUILD-PLAN I2). Becomes a step in the stream."""

    fn: str  # "scenes"
    summary: str  # "Searched Sentinel-2: 9 scenes, 4 clear"
    ms: int
    provenance: Provenance | None = None
    error: str | None = None


# --- Fire (M9c) ---------------------------------------------------------------------------------


class FireDetection(BaseModel):
    """One NASA FIRMS VIIRS active-fire pixel (375 m)."""

    date: date
    lat: float
    lon: float
    frp: float | None = None  # fire radiative power, MW
    confidence: str | None = None  # "low" | "nominal" | "high"
    km_from_area: float  # distance from the area's outline (0 = inside)


class FireList(BaseModel):
    """What `fires(area)` returns: detections near the area, small and capped."""

    detections: list[FireDetection]  # nearest first, capped
    total: int  # detections found, before the cap
    inside: int  # detections inside the outline
    last: str
    radius_km: float
    provenance: Provenance
