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

Speed (the reads are round-trip bound, far more than size or CPU bound):
- the recent list reads cloud masks newest first, a batch at a time, and stops once it has
  its 8 clear passes instead of checking every pass in 4 months;
- long periods pick each month's least cloudy candidates from the catalogue's tile cloud
  figure first, so a 5-year list reads about 3 cloud masks a month, not every pass;
- identical work running at the same time is done once (single flight);
- pass lists are kept on disk too, so a restart or redeploy before a demo keeps them;
- after a view renders, the other bands of that pass and the photos of the next passes are
  rendered in the background, so switching band or date is instant.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import queue
import threading
import time
from collections import defaultdict
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Literal

import earth
from earth import settings as earth_settings
from earth.render import colourise, layer_path, layer_url, rgb_to_png, write_png
from earth.settings import impl
from earth.types import Area, Scene

Band = Literal["photo", "greenness", "water", "bare"]
BANDS: tuple[Band, ...] = ("photo", "greenness", "water", "bare")

#: How far back the passes go: the default recent window, or up to five years for analysis.
Period = Literal["4m", "1y", "2y", "5y"]
_PERIOD_DAYS: dict[str, int] = {"4m": 120, "1y": 365, "2y": 730, "5y": 1826}
_RECENT_MAX = 8  # the default window lists its latest clear passes
_SCAN_BATCH = 8  # cloud masks read per round for the recent list (newest first)
_MONTH_CANDIDATES = 3  # passes per month whose cloud mask a long list reads, least cloudy first
_LONG_SCAN_POOLS = 4  # long lists: batches of cloud masks read side by side
_AHEAD_PASSES = 2  # after a view, also render the photo of this many next passes
_MAX_CLOUD = 30
_REGION_DEG = 0.25  # catalogue searches cover this grid cell, reused by every pin inside it
_REGION_TTL_S = 30 * 60

log = logging.getLogger(__name__)

HALF_M = 1000  # the square is 2 km across
_PRESET = (22.534, 114.0906)  # the offline data is this place only
_SCENE_TTL_S = 30 * 60
_LONG_TTL_S = 24 * 60 * 60  # a year-long list barely changes; re-scanning it is the slow part
_scene_cache: dict[str, tuple[float, list[Scene]]] = {}
_lock = threading.Lock()
# Real reads are network bound (round trips to the imagery), so a few may run at once.
_reads = threading.BoundedSemaphore(6)

_inflight: dict[str, Future] = {}
_regions: dict[str, tuple[float, list]] = {}


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


def _single[T](key: str, fn: Callable[[], T]) -> T:
    """Run `fn` once for everyone asking for `key` at the same time; the others wait for it."""
    with _lock:
        fut = _inflight.get(key)
        mine = fut is None
        if mine:
            fut = _inflight[key] = Future()
    assert fut is not None
    if not mine:
        return fut.result()
    try:
        result = fn()
        fut.set_result(result)
        return result
    except BaseException as exc:
        fut.set_exception(exc)
        raise
    finally:
        with _lock:
            _inflight.pop(key, None)


# --- Pass lists ----------------------------------------------------------------------------


def _ttl(period: str) -> float:
    return _SCENE_TTL_S if period == "4m" else _LONG_TTL_S


def _disk_path(key: str) -> Path:
    name = hashlib.sha1(key.encode()).hexdigest()[:20]
    return earth_settings.data_dir() / "views" / "passes" / f"{name}.json"


def _from_disk(key: str, period: str) -> list[Scene] | None:
    path = _disk_path(key)
    try:
        doc = json.loads(path.read_text())
        if time.time() - float(doc["saved"]) > _ttl(period) or doc["key"] != key:
            return None
        return [Scene.model_validate(s) for s in doc["scenes"]]
    except FileNotFoundError:
        return None
    except Exception:  # a damaged file is just a miss
        log.warning("views: unreadable pass list %s", path, exc_info=True)
        return None


def _to_disk(key: str, scenes: list[Scene]) -> None:
    path = _disk_path(key)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        doc = {
            "key": key,
            "saved": time.time(),
            "scenes": [s.model_dump(mode="json") for s in scenes],
        }
        tmp.write_text(json.dumps(doc))
        tmp.replace(path)
    except Exception:  # the memory cache still has it
        log.warning("views: could not store pass list %s", path, exc_info=True)


def recent_scenes(target: Target, period: Period = "4m") -> list[Scene]:
    """Clear optical passes over the target in the period, newest first.

    The default 4 months lists the latest 8 clear passes. Longer periods (up to 5 years, for
    comparing seasons and years) keep the clearest pass of each month, so a 5-year list stays
    around 60 dates. Cached in memory and on disk for 30 minutes (24 hours for the long
    periods).
    """
    if period not in _PERIOD_DAYS:
        raise ValueError(f"Unknown period {period!r}.")
    _check_offline(target.lat, target.lon)
    key = f"{target.key}|{period}"
    hit = cached_scenes(target, period)
    if hit is not None:
        return hit

    def find() -> list[Scene]:
        found = _from_disk(key, period)
        if found is None:
            found = (
                _find_real(target.area, period)
                if impl() == "real"
                else _find_any(target.area, period)
            )
            _to_disk(key, found)
        with _lock:
            _scene_cache[key] = (time.monotonic(), found)
        return found

    return _single(f"scenes|{key}", find)


def cached_scenes(target: Target, period: Period = "4m") -> list[Scene] | None:
    """The period's pass list if it is already cached in memory (no scan), else None."""
    _check_offline(target.lat, target.lon)
    with _lock:
        hit = _scene_cache.get(f"{target.key}|{period}")
    return hit[1] if hit and time.monotonic() - hit[0] < _ttl(period) else None


def _find_any(area: Area, period: str) -> list[Scene]:
    """Through the `earth` implementation's own scene list (the offline sample)."""
    with _reads:
        found = earth._impl().scenes(
            area, last=f"{_PERIOD_DAYS[period]}d", kind="optical", max_cloud=_MAX_CLOUD
        )
    usable = [s for s in found.scenes if s.usable]
    return usable[:_RECENT_MAX] if period == "4m" else _clearest_per_month(usable)


def _find_real(area: Area, period: str) -> list[Scene]:
    """Live Sentinel-2: search the catalogue, then read only the cloud masks that matter."""
    from earth import real
    from earth.providers import earth_search as es

    end = date.today()
    start = end - timedelta(days=_PERIOD_DAYS[period])
    if period == "4m":
        items = _region_items(area, start - timedelta(days=1), end + timedelta(days=1))
    else:
        items = es.search_long(area, start, end)
    groups = [g for g in es.group(items, area) if start <= g.date <= end]  # newest first

    def scan(batch: list) -> list[Scene]:  # noqa: ANN001 — es.Group
        if not batch:
            return []
        with _reads:
            return [s for s in real._scan(area, batch, _MAX_CLOUD) if s.usable]

    if period == "4m":
        clear: list[Scene] = []
        for i in range(0, len(groups), _SCAN_BATCH):
            clear += scan(groups[i : i + _SCAN_BATCH])
            if len(clear) >= _RECENT_MAX:
                break
        return clear[:_RECENT_MAX]

    def tile_cloud(g) -> float:  # noqa: ANN001 — es.Group
        return min(float(i.properties.get("eo:cloud_cover", 100)) for i in g.items)

    by_month: dict[tuple[int, int], list] = defaultdict(list)
    for g in groups:
        by_month[(g.date.year, g.date.month)].append(g)
    for gs in by_month.values():
        gs.sort(key=tile_cloud)

    def scan_round(batch: list) -> list[Scene]:
        chunks = [batch[i : i + _SCAN_BATCH] for i in range(0, len(batch), _SCAN_BATCH)]
        with ThreadPoolExecutor(max_workers=_LONG_SCAN_POOLS) as pool:
            return [s for part in pool.map(scan, chunks) for s in part]

    # First round: each month's least cloudy candidates. Second round: the next ones, only for
    # months that came up empty.
    clear = scan_round([g for gs in by_month.values() for g in gs[:_MONTH_CANDIDATES]])
    have = {(s.date.year, s.date.month) for s in clear}
    retry = [
        g
        for m, gs in by_month.items()
        if m not in have
        for g in gs[_MONTH_CANDIDATES : 2 * _MONTH_CANDIDATES]
    ]
    clear += scan_round(retry)
    return _clearest_per_month(clear)


def _region_items(area: Area, start: date, end: date) -> list:
    """Catalogue items over the area, from one search of the grid cell around it.

    Pins dropped near each other (a demo, one district) share the cell's search instead of
    each paying a catalogue round trip. Items not touching the area itself are dropped. An
    area that crosses the cell's edge is searched on its own."""
    from shapely.geometry import box, shape

    from earth.providers import earth_search as es

    geom = area.geometry()
    w, s, e, n = geom.bounds
    cw = math.floor(w / _REGION_DEG) * _REGION_DEG
    cs = math.floor(s / _REGION_DEG) * _REGION_DEG
    cell = box(cw, cs, cw + _REGION_DEG, cs + _REGION_DEG)
    if not cell.contains(geom):
        return es.search(area, start, end)
    key = f"{cw:.2f},{cs:.2f}|{start}|{end}"

    def search() -> list:
        with _lock:
            hit = _regions.get(key)
        if hit and time.monotonic() - hit[0] < _REGION_TTL_S:
            return hit[1]
        region = Area.from_geojson(json.loads(json.dumps(cell.__geo_interface__)), name="region")
        found = es.search(region, start, end)
        with _lock:
            _regions[key] = (time.monotonic(), found)
        return found

    found = _single(f"region|{key}", search)
    out = []
    for it in found:
        try:
            if shape(it.geometry).intersects(geom):
                out.append(it)
        except Exception:  # an odd footprint: keep it, the cloud check sorts it out
            out.append(it)
    return out


def _clearest_per_month(scenes: list[Scene]) -> list[Scene]:
    """The least cloudy pass of each calendar month, newest month first."""
    best: dict[tuple[int, int], Scene] = {}
    for s in scenes:
        m = (s.date.year, s.date.month)
        if m not in best or s.cloud_over_area < best[m].cloud_over_area:
            best[m] = s
    return [best[m] for m in sorted(best, reverse=True)]


# --- Rendering -----------------------------------------------------------------------------


def render_view(
    target: Target, band: Band, scene_id: str | None = None, period: Period = "4m"
) -> dict:
    """Render (or reuse) one view. Returns url, WGS84 bounds and the pass it came from.

    Then queues what is likely next: the other bands of this pass and the photo of the next
    passes, so a person flicking through them does not wait."""
    if band not in BANDS:
        raise ValueError(f"Unknown band {band!r}.")
    scenes = recent_scenes(target, period)
    if not scenes:
        raise ViewUnavailable("No clear Sentinel-2 pass over this spot in this period.")
    scene = next((s for s in scenes if s.id == scene_id), None) if scene_id else scenes[0]
    if scene is None:
        raise ViewUnavailable("That pass is not one of the clear ones here in this period.")
    out = _render_cached(target, band, scene)
    if impl() == "real":
        i = scenes.index(scene)
        ahead = [(scene, b) for b in BANDS if b != band] + [
            (s, "photo") for s in scenes[i + 1 : i + 1 + _AHEAD_PASSES]
        ]
        _ahead(target, ahead)
    return out


def _render_cached(target: Target, band: Band, scene: Scene) -> dict:
    vid = target.view_id
    measure = None if band == "photo" else band
    png = layer_path(vid, measure, scene.id)
    meta = png.with_suffix(".json")

    def draw() -> None:
        if not (png.is_file() and meta.is_file()):
            bounds = _render(target.area, scene, measure, vid)
            meta.write_text(json.dumps({"bounds": bounds}))

    if not (png.is_file() and meta.is_file()):
        _single(f"render|{vid}|{band}|{scene.id}", draw)
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


# --- Background work ----------------------------------------------------------------------
#
# Two worker threads, so a long job never holds up a short one:
# - "ahead": small jobs right after a view (the other bands, the next passes' photos);
# - "bulk": whole periods for a place (when it is saved, or someone opens a longer period).
# Heavy reads from both share the `_reads` limit with the views a person is waiting for.


class _Worker:
    def __init__(self, name: str) -> None:
        self.name = name
        self.jobs: queue.Queue[tuple[str, Callable[[], object]]] = queue.Queue()
        self.queued: set[str] = set()
        self.thread: threading.Thread | None = None

    def put(self, key: str, fn: Callable[[], object]) -> bool:
        with _lock:
            if key in self.queued:
                return False
            self.queued.add(key)
            if self.thread is None or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._run, name=self.name, daemon=True)
                self.thread.start()
        self.jobs.put((key, fn))
        return True

    def _run(self) -> None:
        while True:
            key, fn = self.jobs.get()
            try:
                fn()
            except ViewUnavailable:
                pass  # no imagery here: nothing to warm
            except Exception:
                log.warning("%s: %s failed", self.name, key, exc_info=True)
            finally:
                with _lock:
                    self.queued.discard(key)
                self.jobs.task_done()


_bulk = _Worker("views-prefetch")
_near = _Worker("views-ahead")


def _ahead(target: Target, jobs: list[tuple[Scene, Band]]) -> None:
    for scene, band in jobs:
        _near.put(
            f"{target.view_id}|{band}|{scene.id}",
            lambda s=scene, b=band: _render_cached(target, b, s),
        )


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
    return _bulk.put(f"{target.key}|{period}", lambda: prefetch_now(target, period))


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
