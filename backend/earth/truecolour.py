"""True-colour (RGB) reads for real layers, kept apart from `real.py` (M3).

Looks the layer up in `real._layers` (read-only) and reads red/green/blue on the layer's own grid.
Reflectance comes back disk-cached from `earth_search.read`, so a second render is fast.
"""

from __future__ import annotations

import numpy as np

from earth import real
from earth.errors import EarthError
from earth.providers import earth_search as es


def layer_rgb(
    layer_id: str,
) -> tuple[np.ndarray, np.ndarray, tuple[float, float, float, float]]:
    """(H, W, 3) reflectance (NaN = no data), inside-outline mask, WGS84 bounds."""
    layer = real._get(layer_id)
    if layer.scene.kind == "radar":
        raise EarthError(
            "Radar scenes have no true-colour picture.",
            'Render roughness instead: render(index(layer, "roughness")).',
        )
    arrays = es.read(layer.items, ["red", "green", "blue"], layer.gbox)
    rgb = np.stack([arrays["red"], arrays["green"], arrays["blue"]], axis=-1)
    return rgb, layer.inside, es.wgs84_bounds(layer.gbox)
