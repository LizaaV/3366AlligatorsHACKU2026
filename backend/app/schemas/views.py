"""Live views: one rendered square around a spot, to look at before asking."""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Band = Literal["photo", "greenness", "water", "bare"]
Period = Literal["4m", "1y", "2y", "5y"]


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


class PrefetchResult(BaseModel):
    """What a prefetch will render in the background."""

    passes: int | None = Field(
        description="Clear passes in the period; null while the pass list is still being found."
    )
    images: int | None = Field(
        description="Images that will be cached (passes times bands); null while unknown."
    )
    queued: bool = Field(description="False when the same prefetch is already running.")
