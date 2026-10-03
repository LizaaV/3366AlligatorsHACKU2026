"""Catalog registry (issue #41): read-only reference data from `app/registry/catalog.json`.

The JSON is the prototype's registry (`docs/data/`), minus presentation (colours). Map layers
are derived from what `earth` actually renders, not from the prototype's demo overlay stack.
"""

from __future__ import annotations

import json
import typing
from functools import lru_cache
from pathlib import Path

import earth
from app.schemas.catalog import CatalogDto, MapLayerDto, SatelliteDto

REGISTRY = Path(__file__).resolve().parents[1] / "registry"
#: Satellites `earth` fetches scenes from today (earth/providers): the rest are not wired up.
CONNECTED_SATELLITES = frozenset({"s2", "s1"})
LAYER_URL = "/api/layers/{run_id}/{measure}/{scene}.png"

# measure → (name, source, index). Bands as in `earth.real.INDICES` (HANDOFF B1.4).
_LAYERS: dict[str, tuple[str, str, str | None]] = {
    "rgb": ("True colour", "Sentinel-2 B4 / B3 / B2", None),
    "greenness": ("Greenness · plant health", "Sentinel-2 B8 / B4", "NDVI"),
    "moisture": ("Moisture · plant water", "Sentinel-2 B8 / B11", "NDMI"),
    "water": ("Water", "Sentinel-2 B3 / B8", "NDWI"),
    "bare": ("Bare or built ground", "Sentinel-2 B11 / B8", "NDBI"),
    "burn": ("Burn scars", "Sentinel-2 B8 / B12", "NBR"),
    "roughness": ("Surface roughness · radar", "Sentinel-1 VV backscatter (dB)", None),
}


def _map_layers() -> list[MapLayerDto]:
    ids = ["rgb", *typing.get_args(earth.Measure)]
    return [
        MapLayerDto(
            id=i,
            name=_LAYERS[i][0],
            source=_LAYERS[i][1],
            index=_LAYERS[i][2],
            url_template=LAYER_URL.replace("{measure}", i),
        )
        for i in ids
    ]


@lru_cache(maxsize=1)
def get_catalog() -> CatalogDto:
    raw = json.loads((REGISTRY / "catalog.json").read_text(encoding="utf-8"))
    raw["satellites"] = [
        SatelliteDto(**s, connected=s["id"] in CONNECTED_SATELLITES) for s in raw["satellites"]
    ]
    return CatalogDto(**raw, map_layers=_map_layers())


def module_ids() -> frozenset[str]:
    return frozenset(m.id for m in get_catalog().modules)


def category_keys() -> frozenset[str]:
    return frozenset(c.key for c in get_catalog().categories)
