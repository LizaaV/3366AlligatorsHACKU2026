"""NASA FIRMS active fire (VIIRS NRT, 375 m) through the area CSV API (M9c).

The map key is SERVER ONLY: read from `FIRMS_MAP_KEY` here, never returned, logged, put in an
error message or in provenance (the request URL contains it, so URLs are never reported).
"""

from __future__ import annotations

import csv
import io
import math
import os
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

from earth import settings
from earth.errors import EarthError
from earth.types import Area, FireDetection, FireList, Provenance

PROVIDER = "nasa_firms_viirs_nrt"
_NO_KEY_HINT = "fire data needs FIRMS_MAP_KEY on the server"


def window_days(last: str) -> int:
    return int(last[:-1]) * {"d": 1, "w": 7, "m": 30, "y": 365}[last[-1]]


def _key() -> str:
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        raise EarthError(
            "Active-fire data is not available: no FIRMS key is configured.", _NO_KEY_HINT
        )
    return key


def _search_box(area: Area, radius_km: float) -> tuple[float, float, float, float]:
    west, south, east, north = area.bbox()
    lat = area.centroid()[0]
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.05))
    return (
        max(-180.0, west - dlon),
        max(-90.0, south - dlat),
        min(180.0, east + dlon),
        min(90.0, north + dlat),
    )


def _fetch(key: str, source: str, box, days: int, start: date | None) -> str:
    w, s, e, n = box
    url = f"{settings.FIRMS_URL}/{key}/{source}/{w:.4f},{s:.4f},{e:.4f},{n:.4f}/{days}"
    if start is not None:
        url += f"/{start.isoformat()}"
    req = urllib.request.Request(url, headers={"User-Agent": settings.USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=settings.FIRMS_TIMEOUT_S) as resp:  # noqa: S310
            return resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:  # never include the URL: it holds the key
        raise EarthError(
            f"NASA FIRMS answered HTTP {exc.code} for {source}.",
            "Check FIRMS_MAP_KEY on the server, or retry in a moment.",
        ) from None
    except Exception as exc:  # noqa: BLE001
        raise EarthError(
            f"NASA FIRMS request failed ({type(exc).__name__}).", "Retry in a moment."
        ) from None


def parse_csv(text: str) -> list[dict[str, str]]:
    """FIRMS CSV rows. A non-CSV body (bad key, rate limit) is an error, an empty CSV is fine."""
    body = text.strip()
    if not body:
        return []
    if not body.lower().startswith("latitude"):
        raise EarthError(
            "NASA FIRMS did not return fire data (key rejected or rate limit).",
            "Check FIRMS_MAP_KEY on the server, or retry later.",
        )
    return list(csv.DictReader(io.StringIO(body)))


def _confidence(raw: str | None) -> str | None:
    c = (raw or "").strip().lower()
    return {"l": "low", "n": "nominal", "h": "high"}.get(c, c or None)


def _float(raw: str | None) -> float | None:
    try:
        return float(raw) if raw not in (None, "") else None
    except ValueError:
        return None


def build(area: Area, rows: list[dict[str, str]], last: str, radius_km: float) -> FireList:
    """Rows → `FireList`: within radius_km of the outline, nearest first, capped."""
    from pyproj import Transformer
    from shapely.geometry import Point
    from shapely.ops import transform

    fwd = Transformer.from_crs("EPSG:4326", f"EPSG:{area.utm_epsg()}", always_xy=True).transform
    poly = transform(fwd, area.geometry())
    seen: set[tuple] = set()
    found: list[FireDetection] = []
    for r in rows:
        lat, lon = _float(r.get("latitude")), _float(r.get("longitude"))
        if lat is None or lon is None:
            continue
        key = (lat, lon, r.get("acq_date"), r.get("acq_time"))
        if key in seen:
            continue
        seen.add(key)
        try:
            d = datetime.strptime(r["acq_date"], "%Y-%m-%d").date()
        except (KeyError, ValueError):
            continue
        km = poly.distance(Point(*fwd(lon, lat))) / 1000.0
        if km > radius_km:
            continue
        found.append(
            FireDetection(
                date=d,
                lat=round(lat, 4),
                lon=round(lon, 4),
                frp=_float(r.get("frp")),
                confidence=_confidence(r.get("confidence")),
                km_from_area=round(km, 2),
            )
        )
    found.sort(key=lambda f: (f.km_from_area, -f.date.toordinal()))
    return FireList(
        detections=found[: settings.FIRMS_MAX_DETECTIONS],
        total=len(found),
        inside=sum(1 for f in found if f.km_from_area == 0),
        last=last,
        radius_km=radius_km,
        provenance=Provenance(
            provider=PROVIDER,
            satellite="Suomi NPP + NOAA-20",
            scene=f"{len(found)} detections",
            date=date.today(),
            cloud_over_area=0.0,
            resolution_m=375,
            method=(
                f"NASA FIRMS VIIRS near-real-time active fire, {last}, within {radius_km:g} km of "
                "the outline, nearest first; a detection is a hot 375 m pixel, not a burned area"
            ),
        ),
    )


def fires(area: Area, last: str = "30d", radius_km: float = 10) -> FireList:
    key = _key()
    days = window_days(last)
    if days > settings.FIRMS_MAX_WINDOW_DAYS:
        raise EarthError(
            f"last={last!r} is longer than {settings.FIRMS_MAX_WINDOW_DAYS} days.",
            'Use a window up to "90d" (near-real-time data only).',
        )
    box = _search_box(area, radius_km)
    today = date.today()
    jobs = []
    left, start = days, today - timedelta(days=days - 1)
    while left > 0:
        n = min(left, settings.FIRMS_MAX_DAYS)
        jobs += [
            (src, n, start if days > settings.FIRMS_MAX_DAYS else None)
            for src in settings.FIRMS_SOURCES
        ]
        start += timedelta(days=n)
        left -= n
    with ThreadPoolExecutor(max_workers=6) as pool:
        texts = list(pool.map(lambda j: _fetch(key, j[0], box, j[1], j[2]), jobs))
    rows = [row for t in texts for row in parse_csv(t)]
    return build(area, rows, last, radius_km)
