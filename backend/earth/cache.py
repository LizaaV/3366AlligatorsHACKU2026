"""Disk cache for satellite reads, and a short in-memory cache for STAC searches.

Arrays are stored as `.npz` under `<data_dir>/cache/` (git-ignored), keyed by a hash of
(collection, item ids, bands, grid, resolution). Repeated runs on the same place skip the network.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

from earth import settings


def _dir() -> Path:
    return settings.data_dir() / "cache"


def key(*parts: Any) -> str:
    raw = json.dumps(parts, sort_keys=True, default=str)
    return hashlib.sha1(raw.encode()).hexdigest()


def get_arrays(k: str) -> dict[str, np.ndarray] | None:
    path = _dir() / f"{k}.npz"
    if not path.exists():
        return None
    try:
        with np.load(path) as f:
            return {name: f[name] for name in f.files}
    except Exception:  # noqa: BLE001 — a corrupt cache file is just a miss
        path.unlink(missing_ok=True)
        return None


def put_arrays(k: str, arrays: dict[str, np.ndarray]) -> None:
    d = _dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"{k}.{os.getpid()}.{threading.get_ident()}.tmp.npz"
    np.savez_compressed(tmp, **arrays)
    tmp.replace(d / f"{k}.npz")


class TTLCache:
    """Thread-safe in-memory cache with a time-to-live, for STAC search results."""

    def __init__(self, ttl_s: float, max_items: int = 256) -> None:
        self.ttl_s = ttl_s
        self.max_items = max_items
        self._data: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get(self, k: str) -> Any | None:
        with self._lock:
            hit = self._data.get(k)
            if hit is None or time.monotonic() - hit[0] > self.ttl_s:
                return None
            return hit[1]

    def put(self, k: str, value: Any) -> None:
        with self._lock:
            if len(self._data) >= self.max_items:
                oldest = min(self._data, key=lambda x: self._data[x][0])
                del self._data[oldest]
            self._data[k] = (time.monotonic(), value)
