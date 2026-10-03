"""Live views: look at any spot before asking (no agent, no LLM, no cost).

A view is one PNG of a square about 2 km across around a point, in one band (true-colour
photo, greenness, water or bare ground) from one recent Sentinel-2 pass. It is rendered with
the same `earth` code the agent uses and cached on disk, so a view is computed once and then
served as a file. Images go under `data/layers/<view id>/...` and are served by the existing
layer route.

The `earth` implementation is called directly (not through the traced public functions), so
views never count against an agent run's call budget.
"""

from __future__ import annotations

import hashlib
import json
import math
import threading
import time
from typing import Literal

import earth
from earth.render import colourise, layer_path, layer_url, rgb_to_png, write_png
from earth.settings import impl
from earth.types import Area, Scene

Band = Literal["photo", "greenness", "water", "bare"]
BANDS: tuple[Band, ...] = ("photo", "greenness", "water", "bare")

HALF_M = 1000  # the square is 2 km across
_PRESET = (22.534, 114.0906)  # the offline data is this place only
_SCENE_TTL_S = 30 * 60
_scene_cache: dict[str, tuple[float, list[Scene]]] = {}
_lock = threading.Lock()
_reads = threading.BoundedSemaphore(2)  # real reads are heavy; at most two at a time


class ViewUnavailable(Exception):
    """No imagery for this spot (offline data, or no clear pass recently)."""


def _key(lat: float, lon: float) -> str:
    return f"{lat:.4f},{lon:.4f}"


def view_id(lat: float, lon: float) -> str:
    """Folder name for this spot's images (a valid run id)."""
    return "v" + hashlib.sha1(_key(lat, lon).encode()).hexdigest()[:12]


def square(lat: float, lon: float, half_m: float = HALF_M) -> Area:
    dlat = half_m / 110_574
    dlon = half_m / (111_320 * math.cos(math.radians(lat)))
    ring = [
        [lon - dlon, lat - dlat],
        [lon + dlon, lat - dlat],
        [lon + dlon, lat + dlat],
        [lon - dlon, lat + dlat],
        [lon - dlon, lat - dlat],
    ]
    return Area.from_geojson({"type": "Polygon", "coordinates": [ring]}, name="view")


def _check_offline(lat: float, lon: float) -> None:
    if impl() == "stub" and (abs(lat - _PRESET[0]) > 0.1 or abs(lon - _PRESET[1]) > 0.1):
        raise ViewUnavailable(
            "Offline sample data covers Hoo Hok Wai only. Run the backend with EARTH_IMPL=real "
            "to look at other places."
        )


def recent_scenes(lat: float, lon: float) -> list[Scene]:
    """Recent clear optical passes over the spot, newest first (cached for 30 minutes)."""
    _check_offline(lat, lon)
    key = _key(lat, lon)
    with _lock:
        hit = _scene_cache.get(key)
        if hit and time.monotonic() - hit[0] < _SCENE_TTL_S:
            return hit[1]
    with _reads:
        found = earth._impl().scenes(square(lat, lon), last="120d", kind="optical", max_cloud=30)
    clear = [s for s in found.scenes if s.usable][:8]
    with _lock:
        _scene_cache[key] = (time.monotonic(), clear)
    return clear


def render_view(lat: float, lon: float, band: Band, scene_id: str | None = None) -> dict:
    """Render (or reuse) one view. Returns url, WGS84 bounds and the pass it came from."""
    if band not in BANDS:
        raise ValueError(f"Unknown band {band!r}.")
    scenes = recent_scenes(lat, lon)
    if not scenes:
        raise ViewUnavailable("No clear Sentinel-2 pass over this spot in the last 4 months.")
    scene = next((s for s in scenes if s.id == scene_id), None) if scene_id else scenes[0]
    if scene is None:
        raise ViewUnavailable("That pass is not one of the recent clear ones here.")
    vid = view_id(lat, lon)
    measure = None if band == "photo" else band
    png = layer_path(vid, measure, scene.id)
    meta = png.with_suffix(".json")
    if not (png.is_file() and meta.is_file()):
        bounds = _render(lat, lon, scene, measure, vid)
        meta.write_text(json.dumps({"bounds": bounds}))
    bounds = json.loads(meta.read_text())["bounds"]
    return {
        "band": band,
        "url": layer_url(vid, measure, scene.id),
        "bounds": bounds,
        "scene": scene.id,
        "date": scene.date,
        "satellite": scene.satellite,
        "cloud": round(scene.cloud_over_area * 100),
    }


def _render(lat: float, lon: float, scene: Scene, measure: str | None, vid: str) -> list[float]:
    impl_mod = earth._impl()
    with _reads:
        layer = impl_mod.load(square(lat, lon), scene)
        if measure is None:
            if impl() == "stub":
                rgb, inside, bounds = impl_mod.layer_rgb(layer.id)
            else:
                import earth.truecolour as truecolour

                rgb, inside, bounds = truecolour.layer_rgb(layer.id)
            rgb_to_png(rgb, layer_path(vid, None, scene.id), inside)
        else:
            idx = impl_mod.index(layer, measure)
            values, bounds = impl_mod.layer_pixels(idx.id)
            write_png(colourise(values, measure), layer_path(vid, measure, scene.id))
    return [float(b) for b in bounds]
