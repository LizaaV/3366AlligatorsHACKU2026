"""A fixed "pond filling" run against `earth`, streamed as real events (BUILD-PLAN A1).

No LLM: the plan is hard-coded, but every number comes from real `earth` calls (the stub
with EARTH_IMPL=stub, offline), every call becomes a visible step, and the run is stored in
the run store event by event. The agent loop (A3) replaces this with a planned run.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from typing import Any

import earth
from app.schemas.answer import (
    Answer,
    CardRef,
    Confidence,
    Method,
    ProofScene,
    RouteOption,
    StatItem,
)
from app.schemas.runs import RunRecord, RunRequest, new_run_id, new_thread_id
from app.schemas.stream import (
    AnswerEvent,
    BlockReady,
    ClarificationAnswered,
    ClarificationNeeded,
    Done,
    ErrorEvent,
    ExpectationRow,
    GuardEvent,
    HypothesesRegistered,
    RunStarted,
    RunStatus,
    StepFinished,
    StepStarted,
    StreamEvent,
)
from app.services import runs as run_store
from earth.blocks import Block, HypothesisRow
from earth.presets import HOO_HOK_WAI
from knowledge import EventCard, KnowledgeBase, load_knowledge

__all__ = ["HYPOTHESES", "resume_preset_run", "stream_preset_run"]

log = logging.getLogger(__name__)

#: Knowledge cards tested by the preset, best guess first.
HYPOTHESES: tuple[str, ...] = ("pond_filling", "water_loss", "seasonal")
CAUSE = "consistent with the ponds being filled in"
ANSWER_COLOR = "#3b82f6"

# `earth` keeps the run id and listener in module globals: one run talks to it at a time.
_EARTH_LOCK = asyncio.Lock()


def _release_earth() -> None:
    earth.set_listener(None)
    earth.set_run(None)
    _EARTH_LOCK.release()


@lru_cache(maxsize=1)
def _kb() -> KnowledgeBase:
    return load_knowledge()


def _cards() -> list[EventCard]:
    kb = _kb()
    return [kb.events[cid] for cid in HYPOTHESES]


def _method() -> Method:
    return Method(
        cards=[CardRef(id=c.id, version=c.version, status=c.status) for c in _cards()],
        code_ref="preset:pond_filling",
    )


# --- Steps --------------------------------------------------------------------------------------


class _Steps:
    """Runs one `earth` call per step and turns its `EarthCall` into step events."""

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
        cannot be stopped. So the globals are reset and `_EARTH_LOCK` released by a
        done-callback when the *thread* finishes, never when the awaiting task is cancelled
        (client gone): an orphaned call can't leak into the next run's listener or layers.
        """
        await _EARTH_LOCK.acquire()
        try:
            earth.set_run(self.run_id)
            earth.set_listener(calls.append)
            fut = asyncio.ensure_future(asyncio.to_thread(fn, *args, **kw))
        except BaseException:
            _release_earth()
            raise

        def _done(f: asyncio.Future[Any]) -> None:
            _release_earth()
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


# --- Hypotheses ---------------------------------------------------------------------------------


@dataclass
class _Observed:
    before: float
    after: float
    band: tuple[float, float] | None  # normal range for the month of `after`

    @property
    def delta(self) -> float:
        return self.after - self.before

    def text(self) -> str:
        return f"{self.before:.2f} → {self.after:.2f} ({self.delta:+.2f})"


def _expected(sign: Any) -> str:
    by = f" by > {sign.by_more_than:g}" if sign.by_more_than is not None else ""
    return {
        "down": f"↓{by}",
        "up": f"↑{by}",
        "below": f"< {sign.threshold:g}" if sign.threshold is not None else "low",
        "above": f"> {sign.threshold:g}" if sign.threshold is not None else "high",
        "stable": "stable",
        "inside_band": "inside normal range",
        "outside_band": "outside normal range",
    }.get(sign.change, sign.change)


def _passes(sign: Any, obs: _Observed) -> bool | None:
    """Whether one card sign holds for the observed values; None when it can't be checked."""
    by = sign.by_more_than or 0.0
    match sign.change:
        case "down":
            return obs.delta < -by
        case "up":
            return obs.delta > by
        case "below" if sign.threshold is not None:
            return obs.after < sign.threshold
        case "above" if sign.threshold is not None:
            return obs.after > sign.threshold
        case "stable":
            return abs(obs.delta) <= (sign.by_more_than or 0.1)
        case "inside_band" | "outside_band" if obs.band is not None:
            inside = obs.band[0] <= obs.after <= obs.band[1]
            return inside if sign.change == "inside_band" else not inside
    return None


def _expectation_table(cards: list[EventCard]) -> list[ExpectationRow]:
    rows = []
    for card in cards:
        expected: dict[str, list[str]] = {}
        for sign in card.signs:
            expected.setdefault(sign.measure, []).append(_expected(sign))
        rows.append(
            ExpectationRow(
                hypothesis=card.id, expected={m: "; ".join(v) for m, v in expected.items()}
            )
        )
    return rows


def _score(cards: list[EventCard], observed: dict[str, _Observed]) -> list[HypothesisRow]:
    """Check each card's signs on what was measured; rank best first."""
    rows: list[HypothesisRow] = []
    for card in cards:
        expected: dict[str, list[str]] = {}
        passed = tested = 0
        failed_strong = False
        for sign in card.signs:
            expected.setdefault(sign.measure, []).append(_expected(sign))
            obs = observed.get(sign.measure)
            ok = _passes(sign, obs) if obs else None
            if ok is None or (sign.optional and not ok):
                continue
            tested += sign.weight
            passed += sign.weight if ok else 0
            failed_strong |= not ok and sign.weight >= 2
        if tested == 0:
            verdict, reason = "untested", "None of its signs could be measured here."
        elif failed_strong:
            verdict, reason = "contradicted", "A strong sign does not match the data."
        elif passed == tested:
            verdict, reason = "supported", "Every measured sign matches."
        else:
            verdict, reason = "unclear", "Some measured signs match, some don't."
        rows.append(
            HypothesisRow(
                card_id=card.id,
                label=card.name,
                expected={m: "; ".join(v) for m, v in expected.items()},
                observed={m: o.text() for m, o in observed.items() if m in expected},
                verdict=verdict,
                reason=reason,
                score=round(passed / tested, 2) if tested else None,
            )
        )
    order = {"supported": 0, "unclear": 1, "untested": 2, "contradicted": 3}
    return sorted(rows, key=lambda r: (order[r.verdict], -(r.score or 0)))


def _series_observed(s: Any, before: date) -> _Observed:
    first = min(s.points, key=lambda p: abs((p.date - before).days))
    last = s.points[-1]
    band = next(((b.lo, b.hi) for b in s.band if b.month == last.date.month), None)
    return _Observed(before=first.value, after=last.value, band=band)


# --- The run ------------------------------------------------------------------------------------


def _day(d: date) -> str:
    return f"{d.day} {d:%b %Y}"


def _hash(method: Method, scenes: list[str]) -> str:
    payload = json.dumps({"method": method.model_dump(), "scenes": scenes}, sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


async def _events(
    run_id: str, area: earth.Area, st: _Steps, *, intro: bool = True
) -> AsyncIterator[StreamEvent]:
    """The preset plan: hypotheses first, then data, blocks and the answer (no `done`).

    `intro=False` (a resumed run) skips the guard and hypotheses, already in the log.
    """
    cards = _cards()
    if intro:
        yield GuardEvent(scope="answerable")
        yield HypothesesRegistered(
            hypotheses=list(HYPOTHESES), expectation_table=_expectation_table(cards)
        )

    async for ev in st.run(
        "Look up the place", "Size, land cover and recent satellite passes", earth.describe, area
    ):
        yield ev
    async for ev in st.run(
        "Find satellite passes",
        "Sentinel-2 passes over the last two years, cloud measured over the area",
        earth.scenes,
        area,
        last="2y",
    ):
        yield ev
    scene_list: earth.SceneList = st.result
    clear = sorted(scene_list.clear(), key=lambda s: s.date)
    if len(clear) < 2:
        raise earth.NoClearScenes(
            f"Only {len(clear)} clear pass(es) over the area in two years.",
            'Try kind="radar" or a longer window.',
        )
    before, after = clear[0], clear[-1]

    async for ev in st.run(
        "Track open water",
        "Monthly water index, with the normal range from earlier years",
        earth.series,
        area,
        "water",
        years=4,
    ):
        yield ev
    water_series: earth.Series = st.result
    async for ev in st.run(
        "Track greenness",
        "Monthly greenness, with the normal range from earlier years",
        earth.series,
        area,
        "greenness",
        years=4,
    ):
        yield ev
    green_series: earth.Series = st.result
    async for ev in st.run(
        "Compare water before and after",
        f"Water index on {_day(before.date)} vs {_day(after.date)}",
        earth.compare,
        area,
        "water",
        before=before.date,
        after=after.date,
    ):
        yield ev
    cmp: earth.Comparison = st.result

    rendered: list[earth.RenderedLayer] = []
    for label, scene in (("earlier", before), ("latest", after)):
        async for ev in st.run(
            f"Read the {label} image",
            f"{scene.satellite}, {_day(scene.date)}",
            earth.load,
            area,
            scene,
        ):
            yield ev
        async for ev in st.run(
            f"Compute water for the {label} image",
            "Water index (NDWI)",
            earth.index,
            st.result,
            "water",
        ):
            yield ev
        async for ev in st.run(
            f"Draw the {label} water map", "Colour map of the water index", earth.render, st.result
        ):
            yield ev
        rendered.append(st.result)

    observed = {
        "water": _Observed(
            before=cmp.before.mean,
            after=cmp.after.mean,
            band=_series_observed(water_series, before.date).band,
        ),
        "greenness": _series_observed(green_series, before.date),
    }
    ranked = _score(cards, observed)

    blocks: list[Block] = [
        earth.show.then_now(
            rendered[0],
            rendered[1],
            title=f"Water, {_day(before.date)} vs {_day(after.date)}",
            caption="Blue is open water; pale is dry ground.",
            area=area,
            primary=True,
            id="b1",
        ),
        earth.show.timeline(
            water_series,
            title="Open water inside the area",
            caption="Shaded: the normal range for each month before 2025.",
            id="b2",
        ),
        earth.show.timeline(green_series, title="Greenness inside the area", id="b3"),
        earth.show.stat(
            "Area without open water",
            cmp.changed_ha,
            "ha",
            caption=f"Out of {area.area_ha:.1f} ha.",
            provenance=[cmp.before.provenance, cmp.after.provenance],
            id="b4",
        ),
        earth.show.hypotheses(ranked, id="b5"),
    ]
    for block in blocks:
        yield BlockReady(block=block)

    method = _method()
    proof = [
        ProofScene(
            id=s.id,
            date=s.date.isoformat(),
            sat=s.satellite,
            cloud=round(s.cloud_over_area * 100, 1),
            used=s in (before, after),
            why=None if s.usable else f"Cloudy over the area ({s.cloud_over_area:.0%})",
        )
        for s in [before, after, *[s for s in scene_list.scenes if not s.usable][:3]]
    ]
    pond = _kb().events["pond_filling"]
    answer = Answer(
        kind="place",
        title=f"About {cmp.changed_ha:.1f} ha of the ponds no longer show open water",
        eyebrow=area.name or "Your area",
        color=ANSWER_COLOR,
        sentence=(
            f"About {cmp.changed_ha:.1f} ha of the ponds no longer show open water: the water "
            f"index fell from {cmp.before.mean:.2f} to {cmp.after.mean:.2f} between "
            f"{_day(before.date)} and {_day(after.date)}."
        ),
        cause=CAUSE,
        todo="Check later images after heavy rain, or the site itself, before relying on this.",
        stats=[
            StatItem(l="Area without open water", v=f"{cmp.changed_ha:.1f} ha"),
            StatItem(l="Water index", v=f"{cmp.before.mean:.2f} → {cmp.after.mean:.2f}"),
            StatItem(l="Clear passes", v=f"{len(clear)} of {len(scene_list.scenes)}"),
        ],
        confidence=Confidence(
            level="Low",
            pct=40,
            note="The knowledge cards behind this are drafts, not yet tested on known cases.",
        ),
        caveats=list(pond.cannot_tell),
        route=[
            RouteOption(
                sat="Sentinel-2", status="chosen", why="Clear optical passes over the area."
            ),
            RouteOption(sat="Sentinel-1", status="skipped", why="Optical was clear enough."),
        ],
        proof=proof,
        blocks=blocks,
        followups=["Since when?", "Is it the same around the ponds?", "Show every satellite pass"],
        method=method,
        measure_only=False,
        preset=True,
        hash=_hash(method, [before.id, after.id]),
    )
    # Stored before the answer goes out: a client that leaves on `answer` still gets a
    # complete record.
    await asyncio.to_thread(run_store.set_provenance, run_id, st.provenance)
    yield AnswerEvent(answer=answer)


async def _drive(
    run_id: str, body: AsyncIterator[StreamEvent], *, logged: tuple[StreamEvent, ...] = ()
) -> AsyncIterator[StreamEvent]:
    """Stream `body` for `run_id`, storing each event, and end with exactly one `done`.

    `logged` events are already in the store and are only sent. Store writes run in a
    worker thread so a busy database never blocks the event loop. The closing `error` and
    `done` are always sent, even when storing them fails. If the client leaves early, the
    run is closed in the store as `done` once its answer was stored, else `failed`.
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

    def done(status: RunStatus) -> Done:
        return Done(run_id=run_id, status=status, ms=int((time.perf_counter() - start) * 1000))

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
        yield await emit_final(done(status))
    finally:
        if not done_logged:  # client went away, or storing `done` failed
            try:
                run_store.append_event(run_id, done("done" if answered else "failed"))
            except Exception:  # noqa: BLE001 — best effort
                log.warning("run %s: could not close the run", run_id)


async def stream_preset_run(
    req: RunRequest, user_id: str, *, thread_id: str | None = None
) -> AsyncIterator[StreamEvent]:
    """Stream (and store) the preset run for `req`, ending with exactly one `done` event."""
    run_id = new_run_id()
    thread_id = thread_id or req.thread_id or new_thread_id()
    try:
        area = req.area.to_area() if req.area else HOO_HOK_WAI
    except earth.EarthError:
        area = HOO_HOK_WAI  # the route already answered 400 for a bad area
    record = RunRecord(
        run_id=run_id,
        thread_id=thread_id,
        user_id=user_id,
        place_ids=[req.place_id] if req.place_id else [],
        question=req.question,
        area=area,
        status="running",
        method=_method(),
        params={"preset": True, "skill_id": req.skill_id},
    )
    await asyncio.to_thread(run_store.save_run, record)

    async def body() -> AsyncIterator[StreamEvent]:
        yield RunStarted(run_id=run_id, thread_id=thread_id)
        async for ev in _events(run_id, area, _Steps(run_id)):
            yield ev

    async for ev in _drive(run_id, body()):
        yield ev


async def resume_preset_run(
    record: RunRecord, answered: ClarificationAnswered
) -> AsyncIterator[StreamEvent]:
    """Continue a run after its clarification reply (`apply_reply` already stored
    `answered` and set it `running`): sends `answered`, then the rest of the run.

    The preset ignores the answers; the agent loop (A3) reads `record.params["answers"]`.
    """
    st = _Steps(
        record.run_id,
        start=max((s.index for s in record.steps), default=0),
        provenance=record.provenance,
    )
    area = record.area or HOO_HOK_WAI
    body = _events(record.run_id, area, st, intro=False)
    async for ev in _drive(record.run_id, body, logged=(answered,)):
        yield ev
