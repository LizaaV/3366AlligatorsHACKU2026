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

# place_context: max seconds to wait for all context providers before degrading to warnings
CONTEXT_TIMEOUT_S = 15

# Sentinel-2 reads (M1, earth.providers.earth_search)
STAC_URL = "https://earth-search.aws.element84.com/v1"
S2_COLLECTION = "sentinel-2-l2a"
S2_TILE_CLOUD_PREFILTER = 95  # drop hopeless tiles only; never used as the cloud figure
S2_INVALID_SCL = (0, 1, 3, 8, 9, 10)  # no data, saturated, cloud shadow, cloud x2, cirrus
RESOLUTIONS_M = (10, 20, 30, 60)  # auto-drop to stay under MAX_PIXELS_PER_READ
SCENE_SCAN_RESOLUTION_M = 20  # scenes() reads only SCL, at its native 20 m
MIN_CLEAN_PX = 10  # a scene needs at least this many clean pixels over the area to be usable
READ_THREADS = 8
S2_HTTP_TIMEOUT_S = 20  # per HTTP request (HANDOFF B1.6)
SEARCH_TTL_S = 600  # in-memory STAC search cache

# Radar fallback (M9b): Sentinel-1 RTC on Planetary Computer
S1_COLLECTION = "sentinel-1-rtc"
S1_SEARCH_TTL_S = 6 * 3600  # new passes arrive daily; re-search a cached window after this long
S1_READ_TIMEOUT_S = 60  # per pixel read (cold COG reads over a ~25 km² area)
S1_MAX_READ_PIXELS = 2_000_000

# Analysis (M2, earth.real describe / series / compare)
DESCRIBE_LAST_DAYS = 60  # describe() counts optical scenes in this window
SERIES_RESOLUTION_M = 20  # series reads SCL and both bands at 20 m (coarser for large areas)
SERIES_MAX_CLOUD = 0.3  # a period's scene must have at most this unusable share over the area
SERIES_GOOD_CLOUD = 0.1  # stop scanning a period once a scene this clear is found
SERIES_SCAN_ROUNDS = (1, 2, 3)  # SCL reads per period per round, least tile-cloudy first
SERIES_READ_THREADS = 24  # tiny windowed reads are latency-bound: more threads than READ_THREADS
SERIES_NORMAL_MIN_YEARS = 2  # a calendar month needs this many earlier years to get a band
COMPARE_WINDOW_DAYS = 20  # look for a clear scene within ± this many days of each date
COMPARE_WIDE_WINDOW_DAYS = 45  # then widen to this if none
COMPARE_MAX_CLOUD = 0.3  # same meaning as SERIES_MAX_CLOUD
COMPARE_GOOD_CLOUD = 0.1  # the closest scene this clear wins over closer, cloudier ones
COMPARE_FALLBACK_CLOUD = 0.5  # if nothing ≤ COMPARE_MAX_CLOUD: least cloudy scene up to this
CHANGE_THRESHOLDS = {"greenness": 0.15, "water": 0.15, "burn": 0.15, "moisture": 0.10, "bare": 0.10}
MIN_PATCH_HA = 0.1  # changed patches smaller than this are dropped as noise
MAX_PATCHES = 20  # largest first; changed_ha still counts every patch >= MIN_PATCH_HA
SEARCH_SETTLED_DAYS = 90  # STAC results for windows that ended this long ago are cached on disk

# Radar in earth.real (M9b wiring): scenes / load / index / series / compare with kind="radar"
S1_CHANGE_THRESHOLD_DB = 3.0  # HANDOFF B1.4: a > 3 dB VV change is material (changed patches)
S1_COMPARE_WINDOW_DAYS = 30  # nearest same-orbit pass within ± this many days of each date
S1_SERIES_RESOLUTION_M = 10  # = load / compare, so series points match measure() (dB means
# shift ~0.5 dB brighter at 20 m: averaging in linear power before log)
S1_SERIES_THREADS = 16  # parallel radar pixel reads in series (~10 s each cold, 48 in ~30 s)
S1_SERIES_DEADLINE_S = 120  # series stops waiting for slow reads; those periods stay empty
S1_SERIES_TRIES = 2  # passes tried per period before the period is left empty
S1_MIN_COVERAGE = 0.5  # a pass must have valid pixels over at least this share of the area
S1_SEARCH_CHUNK_DAYS = 366  # long windows are searched in chunks (max 500 STAC items per search)
