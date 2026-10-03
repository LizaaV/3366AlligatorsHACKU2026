"""Shared run plumbing for the preset run and the agent loop (BUILD-PLAN A1, A3).

- `drive` streams a run's events, stores each one in the run store and always ends the
  stream with exactly one `done` (also when the body fails or the client leaves).
- `EarthSteps` runs one in-process `earth` call per visible step and turns its `EarthCall`
  into `step_started` / `step_finished` events, holding `EARTH_LOCK` while `earth` is bound
  to the run.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable
from typing import Any

import earth
from app.schemas.stream import (
    AnswerEvent,
    ClarificationNeeded,
    Done,
    ErrorEvent,
    RunStatus,
    StepFinished,
    StepStarted,
    StreamEvent,
)
from app.services import runs as run_store

__all__ = ["EARTH_LOCK", "EarthSteps", "Meter", "drive", "release_earth"]

log = logging.getLogger(__name__)

#: `earth` keeps the run id and listener in module globals: one run talks to it at a time.
EARTH_LOCK = asyncio.Lock()

#: Returns (tokens, cost_usd) so far, for the closing `done` event.
Meter = Callable[[], tuple[int, float]]


def release_earth() -> None:
    """Unbind `earth` from the run and release `EARTH_LOCK`."""
    earth.set_listener(None)
    earth.set_run(None)
    EARTH_LOCK.release()


# --- Steps --------------------------------------------------------------------------------------


class EarthSteps:
    """Runs one `earth` call per step and turns its `EarthCall` into step events.

    `index` is the last step index used; pass `start` to continue numbering after a resume.
    """

    def __init__(
        self, run_id: str, start: int = 0, provenance: list[earth.Provenance] | None = None
    ) -> None:
        self.run_id = run_id
        self.index = start
        self.result: Any = None
        self.provenance: list[earth.Provenance] = list(provenance or [])

    async def _call(
        self, fn: Callable[..., Any], calls: list[earth.EarthCall], *args: Any, **kw: Any
    ) -> Any:
        """Run `fn` in a worker thread with `earth` bound to this run.

        `earth` keeps the run id, listener and call count in module globals, and a thread
        cannot be stopped. So the globals are reset and `EARTH_LOCK` released by a
        done-callback when the *thread* finishes, never when the awaiting task is cancelled
        (client gone): an orphaned call can't leak into the next run's listener or layers.
        """
        await EARTH_LOCK.acquire()
        try:
            earth.set_run(self.run_id)
            earth.set_listener(calls.append)
            fut = asyncio.ensure_future(asyncio.to_thread(fn, *args, **kw))
        except BaseException:
            release_earth()
            raise

        def _done(f: asyncio.Future[Any]) -> None:
            release_earth()
            if not f.cancelled():
                f.exception()  # retrieved here, so an orphan's error is not logged as lost

        fut.add_done_callback(_done)
        return await asyncio.shield(fut)

    async def run(
        self, title: str, desc: str, fn: Callable[..., Any], *args: Any, **kwargs: Any
    ) -> AsyncIterator[StreamEvent]:
        """Yield step_started, call `fn`, yield step_finished; the result is in `self.result`.

        On failure the step_finished carries the error, then the exception is re-raised.
        """
        self.index += 1
        tool = getattr(fn, "__name__", "earth")
        yield StepStarted(index=self.index, title=title, desc=desc, tool=tool)
        calls: list[earth.EarthCall] = []
        start = time.perf_counter()
        error: BaseException | None = None
        try:
            self.result = await self._call(fn, calls, *args, **kwargs)
        except Exception as exc:  # noqa: BLE001 — reported as a step, then re-raised
            error = exc
        ms = int((time.perf_counter() - start) * 1000)
        call = next((c for c in reversed(calls) if c.fn == tool), calls[-1] if calls else None)
        if error is not None:
            kind = getattr(error, "kind", type(error).__name__)
            summary = call.summary if call else f"Failed: {getattr(error, 'message', error)}"
            yield StepFinished(
                index=self.index,
                title=title,
                desc=desc,
                tool=tool,
                result=summary,
                ms=call.ms if call else ms,
                error=call.error if call and call.error else kind,
            )
            raise error
        if call and call.provenance:
            self.provenance.append(call.provenance)
        yield StepFinished(
            index=self.index,
            title=title,
            desc=desc,
            tool=tool,
            result=call.summary if call else "Done",
            ms=call.ms if call else ms,
            provenance=call.provenance if call else None,
        )


# --- Driver -------------------------------------------------------------------------------------


async def drive(
    run_id: str,
    body: AsyncIterator[StreamEvent],
    logged: tuple[StreamEvent, ...] = (),
    *,
    meter: Meter | None = None,
    final_status: Callable[[], RunStatus | None] | None = None,
) -> AsyncIterator[StreamEvent]:
    """Stream `body` for `run_id`, storing each event, and end with exactly one `done`.

    `logged` events are already in the store and are only sent. Store writes run in a
    worker thread so a busy database never blocks the event loop. The closing `error` and
    `done` are always sent, even when storing them fails. If the client leaves early, the
    run is closed in the store as `done` once its answer was stored, else `failed`.

    Optional hooks (the agent loop): `meter()` fills `tokens` and `cost_usd` on every
    `done`; `final_status()` picks the status when the body ends normally (e.g. `refused`),
    None keeps the default (`waiting_user` after `clarification_needed`, else `done`).
    """
    start = time.perf_counter()
    answered = done_logged = False
    last: StreamEvent | None = None

    async def emit(ev: StreamEvent) -> StreamEvent:
        await asyncio.to_thread(run_store.append_event, run_id, ev)
        return ev

    async def emit_final(ev: StreamEvent) -> StreamEvent:
        nonlocal done_logged
        try:
            await emit(ev)
            done_logged = done_logged or isinstance(ev, Done)
        except Exception:  # noqa: BLE001 — the client still gets the event
            log.exception("run %s: could not store %s", run_id, ev.event)
        return ev

    def measured() -> tuple[int, float]:
        if meter is None:
            return 0, 0.0
        try:
            tokens, usd = meter()
            return int(tokens), float(usd)
        except Exception:  # noqa: BLE001 — a closing event must never fail
            log.exception("run %s: could not read the meter", run_id)
            return 0, 0.0

    def done(status: RunStatus) -> Done:
        tokens, usd = measured()
        return Done(
            run_id=run_id,
            status=status,
            tokens=tokens,
            cost_usd=usd,
            ms=int((time.perf_counter() - start) * 1000),
        )

    try:
        for ev in logged:
            yield ev
        try:
            async for ev in body:
                last = await emit(ev)
                answered = answered or isinstance(ev, AnswerEvent)
                yield ev
        except earth.EarthError as exc:
            msg = f"{exc.message} Try: {exc.hint}" if exc.hint else exc.message
            yield await emit_final(ErrorEvent(message=msg, recoverable=True, kind=exc.kind))
            yield await emit_final(done("failed"))
            return
        except Exception:  # noqa: BLE001 — never leak internals to the client
            log.exception("run %s failed", run_id)
            yield await emit_final(
                ErrorEvent(message="The run failed unexpectedly.", recoverable=False)
            )
            yield await emit_final(done("failed"))
            return
        status: RunStatus = "waiting_user" if isinstance(last, ClarificationNeeded) else "done"
        if final_status is not None:
            try:
                status = final_status() or status
            except Exception:  # noqa: BLE001 — keep the default status
                log.exception("run %s: could not read the final status", run_id)
        yield await emit_final(done(status))
    finally:
        if not done_logged:  # client went away, or storing `done` failed
            try:
                run_store.append_event(run_id, done("done" if answered else "failed"))
            except Exception:  # noqa: BLE001 — best effort
                log.warning("run %s: could not close the run", run_id)
