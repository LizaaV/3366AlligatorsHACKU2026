"""Real implementation (M1 read, M2 analysis, M9 providers). Selected with EARTH_IMPL=real.

Must provide the same functions as `earth._stub` with the same return types:
describe, scenes, load, index, measure, series, compare, layer_pixels.
"""

from __future__ import annotations

from datetime import date

import numpy as np

from earth.types import (
    Area,
    Comparison,
    LayerRef,
    Measure,
    PlaceContext,
    Scene,
    SceneKind,
    SceneList,
    Series,
    Stats,
)


def _todo(module: str) -> NotImplementedError:
    return NotImplementedError(
        f"earth real implementation not built yet ({module}); use EARTH_IMPL=stub"
    )


def describe(area: Area) -> PlaceContext:
    raise _todo("M2/M9a")


def scenes(
    area: Area, last: str = "60d", kind: SceneKind = "optical", max_cloud: int = 30
) -> SceneList:
    raise _todo("M1")


def load(area: Area, scene: Scene) -> LayerRef:
    raise _todo("M1")


def index(layer: LayerRef, measure: Measure) -> LayerRef:
    raise _todo("M2")


def measure(layer: LayerRef) -> Stats:
    raise _todo("M2")


def series(area: Area, measure: Measure, years: int = 5, every: str = "month") -> Series:
    raise _todo("M2")


def compare(area: Area, measure: Measure, before: date, after: date) -> Comparison:
    raise _todo("M2")


def layer_pixels(layer_id: str) -> tuple[np.ndarray, tuple[float, float, float, float]]:
    """2-D float array (NaN = masked) of the layer's measure, and its WGS84 bounds."""
    raise _todo("M3")
