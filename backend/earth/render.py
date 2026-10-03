"""Layer → PNG on disk + WGS84 bounds (M3 extends this; ramps move to measure cards later).

PNGs are written when `earth.render()` runs, to
`<data>/layers/{run_id}/{measure}/{scene}.png`; the API route only serves the file.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
from PIL import Image

from earth import settings

# measure → (value at the low end, value at the high end, colour stops low → high)
RAMPS: dict[str, tuple[float, float, list[tuple[int, int, int]]]] = {
    "greenness": (-0.1, 0.8, [(140, 90, 50), (230, 220, 150), (30, 150, 70)]),
    "moisture": (-0.3, 0.5, [(160, 110, 60), (240, 230, 190), (40, 110, 200)]),
    "water": (-0.5, 0.5, [(230, 225, 210), (120, 200, 230), (20, 70, 160)]),
    "bare": (-0.5, 0.3, [(40, 130, 70), (235, 225, 180), (190, 90, 60)]),
    "burn": (-0.3, 0.6, [(60, 20, 20), (230, 200, 140), (40, 140, 70)]),
    "roughness": (-20.0, 0.0, [(20, 20, 30), (120, 120, 130), (240, 240, 240)]),
}


_RUN_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_SCENE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


def validate_run_id(run_id: str) -> str:
    """Run ids become folder names: only `^[a-z0-9][a-z0-9_-]{0,63}$` is allowed."""
    if not isinstance(run_id, str) or not _RUN_ID.fullmatch(run_id):
        raise ValueError(f"Invalid run id {run_id!r}: must match {_RUN_ID.pattern}")
    return run_id


def _check_scene(scene: str) -> None:
    if not isinstance(scene, str) or not _SCENE_ID.fullmatch(scene) or ".." in scene:
        raise ValueError(f"Invalid scene id {scene!r}")


def layer_path(run_id: str, measure: str | None, scene: str) -> Path:
    validate_run_id(run_id)
    _check_scene(scene)
    return settings.data_dir() / "layers" / run_id / (measure or "rgb") / f"{scene}.png"


def layer_url(run_id: str, measure: str | None, scene: str) -> str:
    validate_run_id(run_id)
    _check_scene(scene)
    return f"/api/layers/{run_id}/{measure or 'rgb'}/{scene}.png"


def colourise(values: np.ndarray, measure: str) -> np.ndarray:
    """2-D float array (NaN = no data) → RGBA uint8, NaN transparent."""
    lo, hi, stops = RAMPS[measure]
    t = np.clip((values - lo) / (hi - lo), 0, 1)
    pos = np.linspace(0, 1, len(stops))
    rgba = np.zeros((*values.shape, 4), dtype=np.uint8)
    for c in range(3):
        rgba[..., c] = np.interp(np.nan_to_num(t), pos, [s[c] for s in stops]).astype(np.uint8)
    rgba[..., 3] = np.where(np.isnan(values), 0, 255)
    return rgba


def write_png(rgba: np.ndarray, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(path, optimize=True)
    return path
