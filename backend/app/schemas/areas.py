"""Area inputs and the `/api/areas/resolve` contract (BUILD-PLAN I5, HANDOFF B10)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

import earth

#: Outline limits: enough for any field or pond outline, small enough that a run record
#: (which keeps the outline in its blocks) stays small.
MAX_VERTICES = 10_000
MAX_FEATURES = 200
MAX_DEPTH = 8


def check_geojson_size(geojson: dict[str, Any]) -> dict[str, Any]:
    """Reject outlines with more than MAX_VERTICES positions or MAX_FEATURES features."""
    features = geojson.get("features")
    if isinstance(features, list) and len(features) > MAX_FEATURES:
        raise ValueError(f"Too many features: at most {MAX_FEATURES}.")
    vertices = 0
    stack: list[tuple[Any, int]] = [(geojson, 0)]
    while stack:
        node, depth = stack.pop()
        if depth > MAX_DEPTH:
            raise ValueError("GeoJSON is nested too deeply.")
        if isinstance(node, dict):
            stack.extend((v, depth + 1) for v in node.values())
        elif isinstance(node, list):
            if node and all(isinstance(x, int | float) for x in node):
                vertices += 1
                if vertices > MAX_VERTICES:
                    raise ValueError(f"Outline too detailed: at most {MAX_VERTICES} points.")
            else:
                stack.extend((v, depth + 1) for v in node)
    return geojson


class PointInput(BaseModel):
    """A point plus a radius; the area is the circle around it."""

    lat: float = Field(ge=-90, le=90, description="Latitude in degrees (WGS84).")
    lon: float = Field(ge=-180, le=180, description="Longitude in degrees (WGS84).")
    radius_m: float = Field(400, ge=10, le=50000, description="Circle radius in metres.")


class AreaInput(BaseModel):
    """The area a question is about: exactly one of a GeoJSON outline or a point."""

    geojson: dict | None = Field(
        None, description="GeoJSON Polygon, MultiPolygon, Feature or FeatureCollection (lon/lat)."
    )
    point: PointInput | None = None
    name: str | None = Field(None, max_length=120, description="Display name for the area.")

    @field_validator("geojson")
    @classmethod
    def _size(cls, v: dict | None) -> dict | None:
        return None if v is None else check_geojson_size(v)

    @model_validator(mode="after")
    def _exactly_one(self) -> AreaInput:
        if (self.geojson is None) == (self.point is None):
            raise ValueError("Give exactly one of `geojson` or `point`.")
        return self

    def to_area(self) -> earth.Area:
        """Build the `earth.Area`; `earth.InvalidArea` propagates for bad outlines."""
        if self.point is not None:
            p = self.point
            return earth.Area.from_point(p.lat, p.lon, radius_m=p.radius_m, name=self.name)
        assert self.geojson is not None
        return earth.Area.from_geojson(self.geojson, name=self.name)


class AreaResolveRequest(BaseModel):
    """Turn a search text, point, outline or map link into an area: exactly one field set."""

    query: str | None = Field(
        None, max_length=200, description="Place name, address or 'lat, lon' text."
    )
    point: PointInput | None = None
    geojson: dict | None = None
    link: str | None = Field(
        None, max_length=2000, description="A map link (e.g. Google/OSM) containing coordinates."
    )

    @field_validator("geojson")
    @classmethod
    def _size(cls, v: dict | None) -> dict | None:
        return None if v is None else check_geojson_size(v)

    @model_validator(mode="after")
    def _exactly_one(self) -> AreaResolveRequest:
        given = [v for v in (self.query, self.point, self.geojson, self.link) if v is not None]
        if len(given) != 1:
            raise ValueError("Give exactly one of `query`, `point`, `geojson` or `link`.")
        return self


class AreaMatch(BaseModel):
    """One candidate place from a search."""

    name: str
    lat: float
    lon: float
    description: str | None = Field(
        None,
        description="Where it is, to tell same-named places apart, e.g. 'Texas, United States'.",
    )
    kind: str | None = Field(None, description="What it is, e.g. 'city', 'park', 'lake'.")


class AreaResolveResponse(BaseModel):
    """The resolved area, how it was found, and other candidates for a search."""

    area: earth.Area
    source: Literal["point", "geojson", "coordinates", "link", "search", "preset"] = Field(
        description="How the area was resolved."
    )
    matches: list[AreaMatch] = Field(
        default_factory=list, description="Other search candidates (search only)."
    )
    best: AreaMatch | None = Field(
        None, description="The candidate `area` was built from, with its description (search only)."
    )
