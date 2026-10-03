"""Call log: every public `earth` call is timed, summarised and handed to a listener.

The sandbox runner sets a listener that prints each call as one JSON line; the parent
process turns those into `step_started`/`step_finished` events (BUILD-PLAN I2).
"""

from __future__ import annotations

import functools
import os
import time
from collections.abc import Callable
from typing import Any, ParamSpec, TypeVar

from earth import settings
from earth.errors import BudgetExceeded, EarthError
from earth.types import EarthCall, Provenance

P = ParamSpec("P")
R = TypeVar("R")

_listener: Callable[[EarthCall], None] | None = None
_run_id: str | None = None
_count = 0


def set_listener(fn: Callable[[EarthCall], None] | None) -> None:
    global _listener
    _listener = fn


def set_run(run_id: str | None) -> None:
    """Which run this process works for (used for layer paths). Defaults to $RUN_ID or "local"."""
    global _run_id, _count
    _run_id = run_id
    _count = 0


def current_run() -> str:
    return _run_id or os.environ.get("RUN_ID") or "local"


def traced(summarise: Callable[[Any], str]) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Decorator for public functions. `summarise(result)` → one plain line for the UI."""

    def deco(fn: Callable[P, R]) -> Callable[P, R]:
        @functools.wraps(fn)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            global _count
            _count += 1
            start = time.perf_counter()
            if _count > settings.MAX_CALLS:
                exc = BudgetExceeded(
                    f"{_count} earth calls in this run, max {settings.MAX_CALLS}.",
                    "Use series() or compare() instead of many single reads.",
                )
                _emit(fn.__name__, f"Failed: {exc.message}", start, None, exc.kind)
                raise exc
            try:
                result = fn(*args, **kwargs)
            except EarthError as exc:
                _emit(fn.__name__, f"Failed: {exc.message}", start, None, exc.kind)
                raise
            prov = getattr(result, "provenance", None)
            _emit(
                fn.__name__,
                summarise(result),
                start,
                prov if isinstance(prov, Provenance) else None,
                None,
            )
            return result

        return wrapper

    return deco


def _emit(fn: str, summary: str, start: float, prov: Provenance | None, error: str | None) -> None:
    if _listener is None:
        return
    ms = int((time.perf_counter() - start) * 1000)
    _listener(EarthCall(fn=fn, summary=summary, ms=ms, provenance=prov, error=error))
