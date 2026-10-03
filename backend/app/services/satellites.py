"""Positions of the free Earth-observation satellites, propagated from TLEs with SGP4.

TLEs come from CelesTrak (short timeout, cached 6 h in-process) and fall back to the bundled
snapshot `app/data/tle_snapshot.txt`, so this works offline. Positions are approximate (TEME to
geodetic via GMST, no polar motion), good to a few km: fine for a map.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from sgp4.api import WGS84, Satrec, jday

from app.schemas.satellites import SatelliteDto, TrackPoint

__all__ = ["SATELLITES", "list_satellites", "propagate"]

log = logging.getLogger(__name__)
CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php"
SNAPSHOT = Path(__file__).resolve().parents[1] / "data" / "tle_snapshot.txt"
CACHE_TTL_S = 6 * 3600
FETCH_TIMEOUT_S = 3.0
TRACK_MINUTES = 90
TRACK_STEP_MIN = 2


@dataclass(frozen=True)
class Sat:
    id: str
    name: str
    norad_id: int
    mission: str


SATELLITES: tuple[Sat, ...] = (
    Sat("sentinel-1a", "Sentinel-1A", 39634, "Sentinel-1"),
    Sat("sentinel-2a", "Sentinel-2A", 40697, "Sentinel-2"),
    Sat("sentinel-2b", "Sentinel-2B", 42063, "Sentinel-2"),
    Sat("sentinel-2c", "Sentinel-2C", 60989, "Sentinel-2"),
    Sat("landsat-8", "Landsat 8", 39084, "Landsat"),
    Sat("landsat-9", "Landsat 9", 49260, "Landsat"),
    Sat("terra", "Terra", 25994, "EOS"),
    Sat("aqua", "Aqua", 27424, "EOS"),
    Sat("suomi-npp", "Suomi NPP", 37849, "JPSS"),
)

_cache: dict[int, tuple[float, tuple[str, str]]] = {}
_cache_lock = threading.Lock()


def _parse_tles(text: str) -> dict[int, tuple[str, str]]:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    out: dict[int, tuple[str, str]] = {}
    for i, ln in enumerate(lines[:-1]):
        nxt = lines[i + 1]
        if ln.startswith("1 ") and nxt.startswith("2 "):
            try:
                out[int(ln[2:7])] = (ln, nxt)
            except ValueError:
                continue
    return out


def fetch_tle(norad_id: int) -> tuple[str, str] | None:
    """One TLE (line1, line2) from CelesTrak, or None on any failure. Tests monkeypatch this."""
    try:
        res = httpx.get(
            CELESTRAK_URL, params={"CATNR": norad_id, "FORMAT": "TLE"}, timeout=FETCH_TIMEOUT_S
        )
        res.raise_for_status()
        return _parse_tles(res.text).get(norad_id)
    except Exception as exc:  # network, HTTP or parse: all mean "use the snapshot"
        log.info("celestrak fetch failed for %s: %s", norad_id, exc)
        return None


def _snapshot() -> dict[int, tuple[str, str]]:
    return _parse_tles(SNAPSHOT.read_text(encoding="utf-8"))


def _tle(norad_id: int) -> tuple[str, str] | None:
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(norad_id)
        if hit and now - hit[0] < CACHE_TTL_S:
            return hit[1]
    fresh = fetch_tle(norad_id)
    if fresh is not None:
        with _cache_lock:
            _cache[norad_id] = (now, fresh)
        return fresh
    return _snapshot().get(norad_id)


def _gmst(jd: float, fr: float) -> float:
    t = ((jd - 2451545.0) + fr) / 36525.0
    sec = 67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t**3
    return math.radians((sec % 86400) / 240.0) % (2 * math.pi)


_A = 6378.137
_F = 1 / 298.257223563
_E2 = _F * (2 - _F)


def _geodetic(r: tuple[float, float, float], gmst: float) -> tuple[float, float, float]:
    x = r[0] * math.cos(gmst) + r[1] * math.sin(gmst)
    y = -r[0] * math.sin(gmst) + r[1] * math.cos(gmst)
    z = r[2]
    lon = math.degrees(math.atan2(y, x))
    p = math.hypot(x, y)
    lat = math.atan2(z, p * (1 - _E2))
    for _ in range(5):
        n = _A / math.sqrt(1 - _E2 * math.sin(lat) ** 2)
        lat = math.atan2(z + _E2 * n * math.sin(lat), p)
    n = _A / math.sqrt(1 - _E2 * math.sin(lat) ** 2)
    if abs(math.degrees(lat)) < 89:
        alt = p / math.cos(lat) - n
    else:
        alt = z / math.sin(lat) - n * (1 - _E2)
    return math.degrees(lat), lon, alt


def propagate(tle: tuple[str, str], at: datetime) -> tuple[float, float, float, float] | None:
    """(lat, lon, alt_km, speed_km_s) at `at`, or None if SGP4 fails (decayed/bad TLE)."""
    sat = Satrec.twoline2rv(tle[0], tle[1], WGS84)
    at = at.astimezone(UTC)
    jd, fr = jday(at.year, at.month, at.day, at.hour, at.minute, at.second + at.microsecond / 1e6)
    err, r, v = sat.sgp4(jd, fr)
    if err != 0:
        return None
    lat, lon, alt = _geodetic(r, _gmst(jd, fr))
    return lat, lon, alt, math.sqrt(sum(c * c for c in v))


def list_satellites(at: datetime | None = None) -> list[SatelliteDto]:
    at = (at or datetime.now(UTC)).astimezone(UTC)
    out: list[SatelliteDto] = []
    for sat in SATELLITES:
        tle = _tle(sat.norad_id)
        if tle is None:
            continue
        here = propagate(tle, at)
        if here is None:
            continue
        track = []
        for k in range(TRACK_MINUTES // TRACK_STEP_MIN):
            pt = propagate(tle, at + timedelta(minutes=k * TRACK_STEP_MIN))
            if pt is not None:
                track.append(TrackPoint(lat=round(pt[0], 3), lon=round(pt[1], 3)))
        out.append(
            SatelliteDto(
                id=sat.id,
                name=sat.name,
                norad_id=sat.norad_id,
                mission=sat.mission,
                lat=round(here[0], 4),
                lon=round(here[1], 4),
                alt_km=round(here[2], 1),
                velocity_kms=round(here[3], 3),
                at=at,
                track=track,
            )
        )
    return out
