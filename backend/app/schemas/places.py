"""Place API shapes. Field names follow the frontend's proposed `PlaceDto` (camelCase)."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

PlaceSource = Literal["drawn", "uploaded", "search", "coords", "whatsapp", "parcel", "pin"]


class LatLon(BaseModel):
    lat: float
    lon: float


class DetailRow(BaseModel):
    label: str
    value: str


class PlaceDto(BaseModel):
    id: str
    name: str
    categoryKey: str = ""
    center: LatLon
    geometry: dict  # GeoJSON Polygon/MultiPolygon, WGS84 [lon, lat]
    areaHa: float  # authoritative, computed by `earth.Area`
    isCircle: bool = False
    project: str | None = None
    tags: list[str] = Field(default_factory=list)
    source: PlaceSource = "drawn"
    createdAt: str
    updatedAt: str
    details: list[DetailRow] = Field(default_factory=list)  # derived from the memory profile


class CreatePlaceRequest(BaseModel):
    """Send `geometry` (a GeoJSON polygon) or `center` + `radiusM`."""

    name: str = Field(min_length=1, max_length=120)
    geometry: dict | None = None
    center: LatLon | None = None
    radiusM: float | None = None
    categoryKey: str = Field(default="", max_length=40)
    isCircle: bool | None = None
    project: str | None = Field(default=None, max_length=120)
    tags: list[str] = Field(default_factory=list, max_length=20)
    source: PlaceSource = "drawn"
    details: list[DetailRow] | None = None  # saved to the place's memory profile

    @model_validator(mode="after")
    def _one_geometry(self) -> "CreatePlaceRequest":
        if (self.geometry is None) == (self.center is None):
            raise ValueError("send either `geometry` or `center` + `radiusM`")
        if self.center is not None and self.radiusM is None:
            raise ValueError("`radiusM` is required with `center`")
        return self


class PatchPlaceRequest(BaseModel):
    """Every field optional. Sending `geometry` or `center` + `radiusM` replaces the outline."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    geometry: dict | None = None
    center: LatLon | None = None
    radiusM: float | None = None
    categoryKey: str | None = Field(default=None, max_length=40)
    project: str | None = Field(default=None, max_length=120)
    tags: list[str] | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def _geometry_choice(self) -> "PatchPlaceRequest":
        if self.geometry is not None and self.center is not None:
            raise ValueError("send either `geometry` or `center` + `radiusM`, not both")
        if self.center is not None and self.radiusM is None:
            raise ValueError("`radiusM` is required with `center`")
        return self
