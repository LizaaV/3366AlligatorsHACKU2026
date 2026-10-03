"""Catalog API shapes: registry data the app is built from (issue #41).

Colours are presentation and stay frontend-side, keyed on `CategoryDto.key`.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Tier = Literal["free", "paid"]
#: A module default / step parameter: a JSON scalar or a list of scalars.
ParamValue = str | int | float | bool | list[str | int | float | bool]


class CategoryDto(BaseModel):
    key: str = Field(description="Stable category key, e.g. 'agriculture' (= `category_key`).")
    name: str
    icon: str = Field(description="Material Symbols glyph name.")
    uses: str
    sats: str


class SatelliteDto(BaseModel):
    id: str
    name: str
    res: str
    revisit: str
    tier: Tier
    price: str | None = None
    kind: Literal["optical", "radar", "thermal", "atmos", "lights"]
    note: str
    connected: bool = Field(
        description="True when the backend actually fetches scenes from this source today "
        "(Sentinel-2 via Earth Search, Sentinel-1 via Planetary Computer). The rest are "
        "listed for routing and pricing but are not wired up yet."
    )


class SkillModuleDto(BaseModel):
    """A building block a skill is composed from (a step's `module`)."""

    id: str
    name: str
    icon: str
    group: Literal["Input", "Data", "Analysis", "Output"]
    desc: str
    params: dict[str, ParamValue] = Field(default_factory=dict, description="Default params.")


class DeliveryChannelDto(BaseModel):
    id: Literal["email", "whatsapp", "sms", "push", "slack"]
    name: str
    icon: str
    tier: Tier
    note: str


class LanguageDto(BaseModel):
    code: str
    name: str
    english: str
    region: str
    ui: bool = Field(description="Whether the interface is translated.")
    rtl: bool = False


class MapLayerDto(BaseModel):
    """A kind of map layer the backend renders for a run (`RenderedLayer.measure`).

    The images themselves are served at `url_template` (`GET /api/layers/{run_id}/{measure}/
    {scene}.png`); the actual layers of a run come with its blocks.
    """

    id: str = Field(description="'rgb' or an `earth` measure, as used in the layer URL.")
    name: str
    source: str = Field(description="Sensor and bands, e.g. 'Sentinel-2 B3 / B8'.")
    index: str | None = Field(None, description="Spectral index behind the measure, e.g. NDWI.")
    is_agent_made: bool = Field(True, description="Produced by the agent, not drawn by the user.")
    url_template: str


class CatalogDto(BaseModel):
    categories: list[CategoryDto]
    satellites: list[SatelliteDto]
    modules: list[SkillModuleDto]
    channels: list[DeliveryChannelDto]
    languages: list[LanguageDto]
    map_layers: list[MapLayerDto] = Field(
        description="Layer kinds the backend renders (folded in from the proposed "
        "`GET /api/map-layers`)."
    )
