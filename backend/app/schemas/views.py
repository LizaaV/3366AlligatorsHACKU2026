"""Live views: one rendered square around a spot, to look at before asking."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Band = Literal["photo", "greenness", "water", "bare"]


class ViewPass(BaseModel):
    """A recent clear Sentinel-2 pass over the spot."""

    scene: str
    date: date
    satellite: str
    cloud: int = Field(description="Cloud over the square, percent.")


class ViewImage(BaseModel):
    """One band of one pass, rendered as a PNG pinned to WGS84 bounds."""

    band: Band
    url: str = Field(description="Served by GET /api/layers/...; relative to the API origin.")
    bounds: tuple[float, float, float, float] = Field(description="[west, south, east, north]")
    scene: str
    date: date
    satellite: str
    cloud: int
