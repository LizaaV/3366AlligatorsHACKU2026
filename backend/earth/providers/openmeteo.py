"""Open-Meteo: daily rainfall at the area's centre. A weather MODEL, not a satellite measurement."""

from __future__ import annotations

import hashlib
import json
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from pydantic import BaseModel

from earth import settings
from earth.errors import EarthError
from earth.types import Area

SOURCE = "Open-Meteo (weather model, not satellite)"
_ARCHIVE_LAG_DAYS = 7  # the archive trails real time by a few days
_UNIT_DAYS = {"d": 1, "w": 7, "m": 30, "y": 365}


class RainDay(BaseModel):
    date: date
    mm: float


class RainSeries(BaseModel):
    days: list[RainDay]  # oldest first; days with no model value are left out
    total_mm: float
    source: str = SOURCE
    lat: float
    lon: float


def window_days(last: str) -> int:
    """ "30d" → 30, "8w" → 56, "6m" → 180, "1y" → 365."""
    try:
        return int(last[:-1]) * _UNIT_DAYS[last[-1]]
    except (KeyError, ValueError, IndexError) as exc:
        raise EarthError(
            f"Can't read last={last!r} as a time window.", 'Use like "30d", "8w", "6m", "1y".'
        ) from exc


def _get(url: str, params: dict) -> dict:
    full = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(full, headers={"User-Agent": settings.USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=settings.HTTP_TIMEOUT_S) as resp:  # noqa: S310
            data = json.load(resp)
    except urllib.error.HTTPError as exc:
        raise EarthError(
            f"Open-Meteo answered HTTP {exc.code}.", "Retry later; rain is optional context."
        ) from exc
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise EarthError(
            f"Could not reach Open-Meteo: {exc}", "Retry later; rain is optional context."
        ) from exc
    if not isinstance(data, dict) or "daily" not in data:
        raise EarthError("Open-Meteo returned no daily data.", "Try a shorter window.")
    return data


def _daily(data: dict) -> dict[date, float]:
    daily = data["daily"]
    out: dict[date, float] = {}
    for d, mm in zip(daily["time"], daily["precipitation_sum"], strict=True):
        if mm is not None:
            out[date.fromisoformat(d)] = float(mm)
    return out


def _forecast(lat: float, lon: float, past_days: int) -> dict[date, float]:
    """Recent days (≤ 92) up to yesterday, from the forecast API's analysis."""
    data = _get(
        settings.OPENMETEO_FORECAST_URL,
        {
            "latitude": f"{lat:.4f}",
            "longitude": f"{lon:.4f}",
            "daily": "precipitation_sum",
            "past_days": past_days,
            "forecast_days": 1,
            "timezone": "auto",
        },
    )
    days = _daily(data)
    if days:  # the last entry is today (still in progress or forecast): drop it
        days.pop(max(days))
    return days


def _archive(lat: float, lon: float, start: date, end: date) -> dict[date, float]:
    data = _get(
        settings.OPENMETEO_ARCHIVE_URL,
        {
            "latitude": f"{lat:.4f}",
            "longitude": f"{lon:.4f}",
            "daily": "precipitation_sum",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "timezone": "auto",
        },
    )
    return _daily(data)


def _cache_path(lat: float, lon: float, n: int, today: date) -> Path:
    key = hashlib.sha1(f"{lat:.2f}|{lon:.2f}|{n}|{today}".encode()).hexdigest()[:24]
    return settings.data_dir() / "cache" / "openmeteo" / f"rain-{key}.json"


def rain(area: Area, last: str = "30d") -> RainSeries:
    """Daily rainfall (mm) for the last `last` days ending yesterday, at the area centroid.

    Cached per (centroid at 0.01°, window, day): rain is model data on a ~10 km grid.
    """
    n = window_days(last)
    lat, lon = area.centroid()
    today = date.today()
    path = _cache_path(lat, lon, n, today)
    try:
        return RainSeries.model_validate_json(path.read_text())
    except (OSError, ValueError):
        pass

    if n <= settings.OPENMETEO_MAX_PAST_DAYS:
        found = _forecast(lat, lon, n + 1)  # +1: the forecast API counts today's partial day
    else:
        archive_end = today - timedelta(days=_ARCHIVE_LAG_DAYS)
        found = _archive(lat, lon, today - timedelta(days=n), archive_end)
        recent = _forecast(lat, lon, _ARCHIVE_LAG_DAYS + 1)
        found.update({d: mm for d, mm in recent.items() if d > archive_end})

    days = [RainDay(date=d, mm=round(mm, 1)) for d, mm in sorted(found.items())[-n:]]
    if not days:
        raise EarthError("Open-Meteo has no rain values for this window.", "Try another window.")
    series = RainSeries(
        days=days, total_mm=round(sum(d.mm for d in days), 1), lat=round(lat, 4), lon=round(lon, 4)
    )
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(f".{threading.get_ident()}.tmp")
        tmp.write_text(series.model_dump_json())
        tmp.replace(path)
    except OSError:
        pass
    return series
