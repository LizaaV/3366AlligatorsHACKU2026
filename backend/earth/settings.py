"""`earth` settings from the environment. No app imports: `earth` also runs in the sandbox."""

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def impl() -> str:
    """`stub` (Hoo Hok Wai preset data, no network) or `real`."""
    return os.environ.get("EARTH_IMPL", "stub")


def data_dir() -> Path:
    """Git-ignored working data: cache, rendered layers, memory."""
    return Path(os.environ.get("EARTH_DATA_DIR", BACKEND_DIR / "data"))


# Budgets per run (HANDOFF B1.6)
MAX_CALLS = 30
MAX_SERIES_SCENES = 60
MAX_PIXELS_PER_READ = 2_500_000
MAX_AREA_HA = 2_500  # 25 km², HANDOFF B1.6
MIN_PIXELS_10M = 25  # below ~0.25 ha nothing at 10 m is reliable


# Context providers (M9a): place search, terrain, land cover, rain
USER_AGENT = "earth-agent-hacku/0.1 (HacKU 2026 demo)"  # Nominatim policy: a real User-Agent
HTTP_TIMEOUT_S = 30
NOMINATIM_URL = "https://nominatim.openstreetmap.org"
NOMINATIM_MIN_INTERVAL_S = 1.0  # usage policy: at most 1 request per second
PC_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
OPENMETEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
OPENMETEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
OPENMETEO_MAX_PAST_DAYS = 92
CONTEXT_MAX_READ_PIXELS = 1_500_000  # per raster read for DEM / WorldCover
