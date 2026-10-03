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
    "heat": (10.0, 50.0, [(50, 90, 200), (250, 230, 90), (200, 40, 30)]),  # °C, blue → red
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


# True colour: one fixed stretch for every scene so before/after look comparable.
RGB_BLACK = 0.01  # reflectance mapped to black (takes the haze floor off)
RGB_WHITE = 0.22  # reflectance mapped to white
RGB_GAMMA = 1 / 1.8
RGB_OUTSIDE_DIM = 0.4  # pixels outside the outline keep their photo but at 40% brightness
RGB_MIN_SIDE = 640  # 10 m pixels are tiny on screen: smooth-upscale so it isn't a postage stamp


def _resize(a: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    img = Image.fromarray(a.astype(np.float32), mode="F")
    return np.asarray(img.resize(size, Image.Resampling.BICUBIC))


def _smooth_mask(mask: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Bilinear-upscaled 0..1 mask: a soft outline edge instead of stair steps."""
    img = Image.fromarray(mask.astype(np.float32), mode="F")
    return np.clip(np.asarray(img.resize(size, Image.Resampling.BILINEAR)), 0.0, 1.0)


def rgb_to_png_array(refl: np.ndarray, inside: np.ndarray | None = None) -> np.ndarray:
    """(H, W, 3) reflectance (NaN = no data) → RGBA uint8.

    Fixed stretch (0.01–0.22 reflectance, gamma 1/1.8), the same for every scene. No-data pixels
    are transparent; pixels outside the outline are dimmed to 40% so the area stays readable in
    context. Small grids are bicubic-upscaled so the longer side is at least 640 px.
    """
    h, w = refl.shape[:2]
    nodata = np.isnan(refl).any(axis=-1)
    ins = np.ones((h, w), bool) if inside is None else inside
    chans = np.nan_to_num(refl)
    k = max(1, int(np.ceil(RGB_MIN_SIDE / max(h, w))))
    if k > 1:
        size = (w * k, h * k)
        chans = np.stack([_resize(chans[..., c], size) for c in range(3)], axis=-1)
        nodata = _resize(nodata.astype(np.float32), size) > 0.5
        ins = _smooth_mask(ins, size)
    t = np.clip((chans - RGB_BLACK) / (RGB_WHITE - RGB_BLACK), 0, 1) ** RGB_GAMMA
    gain = RGB_OUTSIDE_DIM + (1 - RGB_OUTSIDE_DIM) * ins.astype(np.float32)
    t = t * gain[..., None]
    rgba = np.zeros((*t.shape[:2], 4), dtype=np.uint8)
    rgba[..., :3] = np.rint(t * 255).astype(np.uint8)
    rgba[..., 3] = np.where(nodata, 0, 255)
    return rgba


def rgb_to_png(refl: np.ndarray, path: Path, inside: np.ndarray | None = None) -> Path:
    return write_png(rgb_to_png_array(refl, inside), path)
