"""OpenStreetMap Nominatim: place search and reverse geocoding.

Usage policy (https://operations.osmfoundation.org/policies/nominatim/): a real User-Agent,
at most 1 request per second (enforced here across threads), and results cached on disk.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from pydantic import BaseModel

from earth import settings
from earth.errors import EarthError
from earth.types import Area

# --- rate limiter -------------------------------------------------------------------------------

_lock = threading.Lock()
_last_request = 0.0
_clock = time.monotonic  # replaced in tests
_sleep = time.sleep


def _throttle() -> None:
    """Block until at least NOMINATIM_MIN_INTERVAL_S since the previous request (all threads)."""
    global _last_request
    with _lock:
        wait = _last_request + settings.NOMINATIM_MIN_INTERVAL_S - _clock()
        if wait > 0:
            _sleep(wait)
        _last_request = _clock()


def _http_get(url: str) -> object:
    _throttle()
    req = urllib.request.Request(url, headers={"User-Agent": settings.USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=settings.HTTP_TIMEOUT_S) as resp:  # noqa: S310
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            raise EarthError(
                "Nominatim is rate limiting us (HTTP 429).", "Wait a few seconds and retry."
            ) from exc
        raise EarthError(
            f"Nominatim answered HTTP {exc.code}.", "Retry later, or use coordinates instead."
        ) from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise EarthError(
            f"Could not reach Nominatim: {exc}", "Check the network, or use coordinates instead."
        ) from exc


# --- disk cache ---------------------------------------------------------------------------------


def _cache_dir() -> Path:
    return settings.data_dir() / "cache" / "nominatim"


def _cache_path(key: str) -> Path:
    return _cache_dir() / (hashlib.sha1(key.encode()).hexdigest()[:24] + ".json")


def _cached(key: str, fetch):
    """JSON disk cache. `fetch()` runs on a miss; its result (even None) is stored."""
    path = _cache_path(key)
    try:
        return json.loads(path.read_text())["value"]
    except (OSError, ValueError, KeyError):
        pass
    value = fetch()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
        tmp.write_text(json.dumps({"key": key, "value": value}))
        tmp.replace(path)
    except OSError:
        pass  # cache is best effort
    return value


# --- model --------------------------------------------------------------------------------------


class PlaceHit(BaseModel):
    name: str
    display_name: str
    lat: float
    lon: float
    bbox: tuple[float, float, float, float]  # (west, south, east, north)
    kind: str  # OSM "class/type", e.g. "place/suburb"
    country: str | None = None
    # The town or region it is in (city, else county, else state), to tell same names apart.
    region: str | None = None
    geojson: dict | None = None  # Polygon / MultiPolygon if Nominatim returned one

    def area(self, radius_m: float = 400) -> Area:
        """The polygon if there is one of a usable size (≥ 0.25 ha, < 25 km²), else a circle."""
        if self.geojson:
            try:
                poly = Area.from_geojson(self.geojson, name=self.name)
                if (
                    poly.pixels(10) >= settings.MIN_PIXELS_10M
                    and poly.area_ha < settings.MAX_AREA_HA
                ):
                    return poly
            except EarthError:
                pass
        return Area.from_point(self.lat, self.lon, radius_m=radius_m, name=self.name)


def _country(address: dict) -> str | None:
    if address.get("ISO3166-2-lvl3") == "CN-HK":
        return "Hong Kong"  # Nominatim says "China"; users mean Hong Kong
    if address.get("ISO3166-2-lvl3") == "CN-MO":
        return "Macao"
    return address.get("country")


_REGION_KEYS = ("city", "town", "village", "municipality", "county", "state_district", "state")


def _region(address: dict, name: str) -> str | None:
    for key in _REGION_KEYS:
        value = address.get(key)
        if value and value != name:
            return value
    return None


def _hit(raw: dict) -> PlaceHit:
    south, north, west, east = (float(v) for v in raw["boundingbox"])
    geo = raw.get("geojson")
    names = raw.get("namedetails") or {}
    name = names.get("name:en") or raw.get("name") or raw["display_name"].split(",")[0]
    return PlaceHit(
        name=name,
        display_name=raw["display_name"],
        lat=float(raw["lat"]),
        lon=float(raw["lon"]),
        bbox=(west, south, east, north),
        kind=f"{raw.get('category', '')}/{raw.get('type', '')}",
        country=_country(raw.get("address") or {}),
        region=_region(raw.get("address") or {}, name),
        geojson=geo
        if isinstance(geo, dict) and geo.get("type") in ("Polygon", "MultiPolygon")
        else None,
    )


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


# --- public -------------------------------------------------------------------------------------


def search(text: str, limit: int = 5) -> list[PlaceHit]:
    """Places matching free text, best first. Raises EarthError on network trouble."""
    q = _norm(text or "")
    if not q:
        raise EarthError("Empty place name.", 'Pass a name like "Wong Tai Sin".')
    limit = max(1, min(int(limit), 20))

    def fetch() -> list[dict]:
        params = {
            "q": q,
            "format": "jsonv2",
            "polygon_geojson": 1,
            "addressdetails": 1,
            "namedetails": 1,
            "accept-language": "en",
            "limit": limit,
        }
        data = _http_get(f"{settings.NOMINATIM_URL}/search?{urllib.parse.urlencode(params)}")
        return data if isinstance(data, list) else []

    raws = _cached(f"search|{q}|{limit}", fetch)
    return [_hit(r) for r in raws]


def reverse(lat: float, lon: float) -> PlaceHit | None:
    """The place at a coordinate (village / suburb level), or None (open ocean, no data)."""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise EarthError(f"Not a valid coordinate: {lat}, {lon}", "Use reverse(lat, lon).")

    def fetch() -> dict | None:
        params = {
            "lat": f"{lat:.5f}",
            "lon": f"{lon:.5f}",
            "format": "jsonv2",
            "addressdetails": 1,
            "namedetails": 1,
            "zoom": 14,
            "accept-language": "en",
        }
        data = _http_get(f"{settings.NOMINATIM_URL}/reverse?{urllib.parse.urlencode(params)}")
        if not isinstance(data, dict) or "error" in data or "boundingbox" not in data:
            return None
        return data

    raw = _cached(f"reverse|{lat:.4f}|{lon:.4f}", fetch)
    return _hit(raw) if raw else None
