"""Live views: look at any spot before asking (no agent, no LLM, no cost).

A view is one PNG in one band (true-colour photo, greenness, water or bare ground) from one
recent Sentinel-2 pass, of either a saved place's own outline (pixels outside it are
transparent, so the colours fit the shape exactly) or, for a dropped pin, a square about 2 km
across around the point. It is rendered with
the same `earth` code the agent uses and cached on disk, so a view is computed once and then
served as a file. Images go under `data/layers/<view id>/...` and are served by the existing
layer route.

The `earth` implementation is called directly (not through the traced public functions), so
views never count against an agent run's call budget.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import queue
import threading
import time
from dataclasses import dataclass
from typing import Literal

import earth
from earth.render import colourise, layer_path, layer_url, rgb_to_png, write_png
from earth.settings import impl
from earth.types import Area, Scene

Band = Literal["photo", "greenness", "water", "bare"]
BANDS: tuple[Band, ...] = ("photo", "greenness", "water", "bare")

#: How far back the passes go: the default recent window, or up to five years for analysis.
Period = Literal["4m", "1y", "2y", "5y"]
_PERIOD_DAYS: dict[str, int] = {"4m": 120, "1y": 365, "2y": 730, "5y": 1826}
_RECENT_MAX = 8  # the default window lists its latest clear passes

log = logging.getLogger(__name__)

HALF_M = 1000  # the square is 2 km across
_PRESET = (22.534, 114.0906)  # the offline data is this place only
_SCENE_TTL_S = 30 * 60
_LONG_TTL_S = 24 * 60 * 60  # a year-long list barely changes; re-scanning it is the slow part
_scene_cache: dict[str, tuple[float, list[Scene]]] = {}
_lock = threading.Lock()
_reads = threading.BoundedSemaphore(2)  # real reads are heavy; at most two at a time


class ViewUnavailable(Exception):
    """No imagery for this spot (offline data, or no clear pass recently)."""


@dataclass(frozen=True)
class Target:
    """What a view shows: an area, plus a stable key for its cache."""

    area: Area
    key: str
    lat: float
    lon: float

    @property
    def view_id(self) -> str:
        """Folder name for this target's images (a valid run id)."""
        return "v" + hashlib.sha1(self.key.encode()).hexdigest()[:12]


def spot(lat: float, lon: float) -> Target:
    """A dropped pin: a 2 km square around it, for looking around."""
    return Target(square(lat, lon), f"spot:{lat:.4f},{lon:.4f}", lat, lon)


def place(place_id: str, geojson: dict, name: str | None = None) -> Target:
    """A saved place: its own outline. The key includes the outline, so a redrawn place
    renders afresh instead of reusing the old shape's images."""
    area = Area.from_geojson(geojson, name=name)
    shape = hashlib.sha1(json.dumps(geojson, sort_keys=True).encode()).hexdigest()[:10]
    lat, lon = area.centroid()
    return Target(area, f"place:{place_id}:{shape}", lat, lon)


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


def recent_scenes(target: Target, period: Period = "4m") -> list[Scene]:
    """Clear optical passes over the target in the period, newest first.

    The default 4 months lists the latest 8 clear passes. Longer periods (up to 5 years, for
    comparing seasons and years) keep the clearest pass of each month, so a 5-year list stays
    around 60 dates. Cached for 30 minutes (24 hours for the long periods).
    """
    if period not in _PERIOD_DAYS:
        raise ValueError(f"Unknown period {period!r}.")
    _check_offline(target.lat, target.lon)
    key = f"{target.key}|{period}"
    ttl = _SCENE_TTL_S if period == "4m" else _LONG_TTL_S
    with _lock:
        hit = _scene_cache.get(key)
        if hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
    with _reads:
        found = earth._impl().scenes(
            target.area, last=f"{_PERIOD_DAYS[period]}d", kind="optical", max_cloud=30
        )
    usable = [s for s in found.scenes if s.usable]
    clear = usable[:_RECENT_MAX] if period == "4m" else _clearest_per_month(usable)
    with _lock:
        _scene_cache[key] = (time.monotonic(), clear)
    return clear


def _clearest_per_month(scenes: list[Scene]) -> list[Scene]:
    """The least cloudy pass of each calendar month, newest month first."""
    best: dict[tuple[int, int], Scene] = {}
    for s in scenes:
        m = (s.date.year, s.date.month)
        if m not in best or s.cloud_over_area < best[m].cloud_over_area:
            best[m] = s
    return [best[m] for m in sorted(best, reverse=True)]


def render_view(
    target: Target, band: Band, scene_id: str | None = None, period: Period = "4m"
) -> dict:
    """Render (or reuse) one view. Returns url, WGS84 bounds and the pass it came from."""
    if band not in BANDS:
        raise ValueError(f"Unknown band {band!r}.")
    scenes = recent_scenes(target, period)
    if not scenes:
        raise ViewUnavailable("No clear Sentinel-2 pass over this spot in this period.")
    scene = next((s for s in scenes if s.id == scene_id), None) if scene_id else scenes[0]
    if scene is None:
        raise ViewUnavailable("That pass is not one of the clear ones here in this period.")
    return _render_cached(target, band, scene)


def _render_cached(target: Target, band: Band, scene: Scene) -> dict:
    vid = target.view_id
    measure = None if band == "photo" else band
    png = layer_path(vid, measure, scene.id)
    meta = png.with_suffix(".json")
    if not (png.is_file() and meta.is_file()):
        bounds = _render(target.area, scene, measure, vid)
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


def _render(area: Area, scene: Scene, measure: str | None, vid: str) -> list[float]:
    impl_mod = earth._impl()
    with _reads:
        layer = impl_mod.load(area, scene)
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


# --- Prefetch: render every band of every listed pass in the background -----------------------
#
# A saved place is looked at again and again, so its views are rendered ahead of time: when the
# place is created (the recent window) and when someone opens a longer period. One worker
# thread does it, one job per (place, period) at a time, so it never crowds out the views a
# person is waiting for (those share the `_reads` limit of two heavy reads).

_jobs: queue.Queue[tuple[Target, Period]] = queue.Queue()
_queued: set[str] = set()
_worker: threading.Thread | None = None


def prefetch_place(place_id: str, geojson: dict, name: str | None = None) -> None:
    """A place was saved or redrawn: render its recent views ahead of time. Only with real
    imagery; the offline sample renders instantly and needs no warming."""
    if impl() != "real":
        return
    try:
        prefetch(place(place_id, geojson, name))
    except Exception:  # warming the cache must never fail saving a place
        log.warning("prefetch: could not queue place %s", place_id, exc_info=True)


def prefetch(target: Target, period: Period = "4m") -> bool:
    """Queue rendering of all bands for all passes in the period. False if already queued."""
    global _worker
    key = f"{target.key}|{period}"
    with _lock:
        if key in _queued:
            return False
        _queued.add(key)
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_work, name="views-prefetch", daemon=True)
            _worker.start()
    _jobs.put((target, period))
    return True


def prefetch_now(target: Target, period: Period = "4m") -> int:
    """Render all bands for all passes in the period, here and now. Returns how many rendered
    or were already cached. Used by the worker, and directly by tests."""
    done = 0
    for scene in recent_scenes(target, period):
        for band in BANDS:
            try:
                _render_cached(target, band, scene)
                done += 1
            except Exception:  # one bad pass must not stop the rest
                log.warning("prefetch: %s %s %s failed", target.key, scene.id, band, exc_info=True)
    return done


def _work() -> None:
    while True:
        target, period = _jobs.get()
        try:
            prefetch_now(target, period)
        except ViewUnavailable:
            pass  # no imagery here: nothing to warm
        except Exception:
            log.warning("prefetch: %s %s failed", target.key, period, exc_info=True)
        finally:
            with _lock:
                _queued.discard(f"{target.key}|{period}")
            _jobs.task_done()
