"""Place API shapes. snake_case throughout (team convention, docs/API.md)."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator

from app.schemas.areas import check_geojson_size

PlaceSource = Literal["drawn", "uploaded", "search", "coords", "whatsapp", "parcel", "pin"]
Tag = Annotated[str, StringConstraints(max_length=40)]


class LatLon(BaseModel):
    lat: float
    lon: float


class DetailRow(BaseModel):
    label: str = Field(max_length=40)
    value: str = Field(max_length=300)


class PlaceDto(BaseModel):
    id: str
    name: str
    category_key: str = ""
    center: LatLon
    geometry: dict  # GeoJSON Polygon/MultiPolygon, WGS84 [lon, lat]
    area_ha: float  # authoritative, computed by `earth.Area`
    is_circle: bool = False
    project: str | None = None
    tags: list[str] = Field(default_factory=list)
    source: PlaceSource = "drawn"
    created_at: str
    updated_at: str
    details: list[DetailRow] = Field(default_factory=list)  # derived from the memory profile


class _OutlineMixin(BaseModel):
    geometry: dict | None = None
    center: LatLon | None = None
    radius_m: float | None = Field(default=None, gt=0)

    @field_validator("geometry")
    @classmethod
    def _size(cls, v: dict | None) -> dict | None:
        return None if v is None else check_geojson_size(v)


class CreatePlaceRequest(_OutlineMixin):
    """Send `geometry` (a GeoJSON polygon; `center` is then ignored and recomputed),
    or `center` + `radius_m` for a dropped pin."""

    name: str = Field(min_length=1, max_length=120)
    category_key: str = Field(default="", max_length=40)
    is_circle: bool | None = None
    project: str | None = Field(default=None, max_length=120)
    tags: list[Tag] = Field(default_factory=list, max_length=20)
    source: PlaceSource = "drawn"
    details: list[DetailRow] | None = Field(default=None, max_length=30)  # -> memory profile

    @model_validator(mode="after")
    def _need_outline(self) -> "CreatePlaceRequest":
        if self.geometry is None and (self.center is None or self.radius_m is None):
            raise ValueError("send `geometry`, or `center` + `radius_m`")
        return self


class PatchPlaceRequest(_OutlineMixin):
    """Every field optional. Sending `geometry` (wins over `center`) or `center` + `radius_m`
    replaces the outline."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    category_key: str | None = Field(default=None, max_length=40)
    is_circle: bool | None = None
    project: str | None = Field(default=None, max_length=120)
    tags: list[Tag] | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def _need_radius(self) -> "PatchPlaceRequest":
        if self.geometry is None and self.center is not None and self.radius_m is None:
            raise ValueError("`radius_m` is required with `center`")
        return self
