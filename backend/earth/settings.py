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
