"""Satellite position API shapes: current positions of the free Earth-observation satellites."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

__all__ = ["SatelliteDto", "TrackPoint"]


class TrackPoint(BaseModel):
    lat: float = Field(description="Geodetic latitude, degrees.")
    lon: float = Field(description="Longitude, degrees east, -180..180.")


class SatelliteDto(BaseModel):
    id: str = Field(description="Stable slug, e.g. 'sentinel-2a'.")
    name: str
    norad_id: int
    mission: str = Field(description="Programme, e.g. 'Sentinel-2'.")
    lat: float
    lon: float
    alt_km: float = Field(description="Height above the WGS84 ellipsoid.")
    velocity_kms: float = Field(description="Speed in km/s.")
    at: datetime = Field(description="Instant (UTC) the position is for.")
    track: list[TrackPoint] = Field(
        description="Sub-satellite points for the next ~90 min at 2-min steps (45 points)."
    )
