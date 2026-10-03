"""The agent loop (BUILD-PLAN A3, ARCHITECTURE §4.0): code gates, guard, then model ⇄ tools.

    async for ev in stream_agent_run(req, user_id, provider): ...      # POST /api/runs
    async for ev in resume_agent_run(record, answered, provider): ...  # POST /runs/{id}/reply

Both stream through `run_driver.drive`, which stores every event and always ends with
exactly one `done` (with `tokens` and `cost_usd` from the run's usage).

A new run goes:

1. `run_started`, then code gates (injection pre-check, area size, military overlap) and the
   guard (one structured call) -> `guard`. Block rules end the run here (`limits` block,
   `done{refused}`), redirect rules end it with a short template answer; partial / ask rules
   continue with a policy note for the model.
2. Grounding, when the run has an area: `earth.describe` as a visible step ("Look up the
   place"), setting cards for the land cover, the user's memory (untrusted data; its values
   are kept privately in `AgentState.memory_values` for the leak check).
3. The loop: one model turn, its tool calls run in order through `tools.iter_handle` (their
   events stream live), all results go back in ONE user message, state is persisted after
   every turn. It ends with an accepted `finish` (code scoring + answer), a template
   measure-only answer when a cap is hit (never a dead run), a pause on `ask_user`
   (`clarification_needed`, `done{waiting_user}`), or a refusal (`limits`, `done{refused}`).

The transcript is append-only: earlier messages (with the provider's raw payload, e.g.
Claude's thinking blocks) are never edited. The system prompt is stable (cached); all
per-run content goes in messages. The demo preset is never used as a stand-in area here.
"""

from __future__ import annotations

import asyncio
import importlib
import logging
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

import earth
from app.core.config import settings
from app.schemas.answer import Answer, Confidence, Method
from app.schemas.runs import Cost, RunRecord, RunRequest, new_run_id, new_thread_id
from app.schemas.stream import (
    AnswerEvent,
    BlockReady,
    ClarificationAnswered,
    ClarificationNeeded,
    ErrorEvent,
    GuardEvent,
    RunStarted,
    RunStatus,
    StreamEvent,
)
from app.services import memory
from app.services import runs as run_store
from app.services.agent import answer as answers
from app.services.agent import guard as guard_mod
from app.services.agent import harness, policy, prompts, scoring, tools
from app.services.agent import skills as skill_lib
from app.services.agent.harness import Limits
from app.services.agent.llm.base import (
    LLMError,
    LLMProvider,
    Message,
    ToolResult,
    Turn,
)
from app.services.agent.state import AGENT_KEY, AgentState, BlockRef, GuardVerdict, PlaceInfo
from app.services.run_driver import EarthSteps, drive
from earth.blocks import Block
from knowledge import WORLDCOVER_CODES, KnowledgeBase, load_knowledge

__all__ = [
    "LAST_TURN_NUDGE",
    "PLACES_MODULE",
    "lookup_place",
    "memory_values",
    "answer_values",
    "resume_agent_run",
    "stream_agent_run",
    "stream_unavailable",
]

log = logging.getLogger(__name__)

#: Effort for agent turns (the guard uses "low").
TURN_EFFORT = "medium"
#: Optional saved-places service (Meet's PR); feature-detected, never required.
PLACES_MODULE = "app.services.places"
#: Setting cards given to the model up front (by land-cover share, largest first).
MAX_SETTING_CARDS = 2
#: params key for the loop's own flags (AgentState is frozen): the nudge-once markers,
#: kept so a resumed run does not nudge again.
LOOP_KEY = "agent_loop"
MIN_LAND_COVER_SHARE = 0.05
#: Seconds the guard call may take (the SDK's own timeout and retry are much longer).
GUARD_TIMEOUT_S = 30.0
#: The guard event sent when the model declines mid-run (no policy rule fired).
REFUSAL_SCOPE = "not_allowed"
MODEL_REFUSAL = "The AI model declined to answer this question."
#: Extra seconds a model call may run past the wall clock before it is abandoned.
CALL_GRACE_S = 20.0
MIN_CALL_TIMEOUT_S = 15.0

LAST_TURN_NUDGE = (
    "This is your last turn: call finish now with what you have (measure-only if no card "
    "is supported)."
)
_CUT_OFF = (
    "Your last reply hit the output limit and was cut off, so its tool calls were not run. "
    "Reply again more briefly: shorter scripts, fewer calls per turn."
)
_NO_TOOL = (
    "Text outside a tool call is not shown to the user. Continue with a tool, or call finish "
    "to give the answer."
)
_NOT_RUN = "Not run: your reply was cut off before this call was complete."
_LLM_DOWN = "The AI model is not reachable right now. Please try again in a minute."

#: ESA WorldCover class names as `earth.describe` reports them -> class codes.
_LAND_COVER_CODES: dict[str, int] = {
    "trees": 10,
    "shrubland": 20,
    "grassland": 30,
    "cropland": 40,
    "built": 50,
    "bare": 60,
    "snow_ice": 70,
    "water": 80,
    "wetland": 90,
    "mangroves": 95,
    "moss_lichen": 100,
    **{name: code for code, name in WORLDCOVER_CODES.items()},
}


@lru_cache(maxsize=1)
def _default_kb() -> KnowledgeBase:
    return load_knowledge()


# --- Places and memory ----------------------------------------------------------------------


_GEOJSON_TYPES = ("Polygon", "MultiPolygon", "Feature", "Point")


def _as_area(value: Any, name: str | None = None) -> earth.Area | None:
    """An `earth.Area` from what a places service returns: an Area, an AreaInput, GeoJSON,
    or an object / dict holding one under `geometry` (the places service's `PlaceDto`),
    `area` or `geojson`. The record's `name` names the area when the geometry has none."""
    if value is None:
        return None
    if isinstance(value, earth.Area):
        return value
    to_area = getattr(value, "to_area", None)
    if callable(to_area):
        return to_area()

    def get(key: str) -> Any:
        return value.get(key) if isinstance(value, Mapping) else getattr(value, key, None)

    if isinstance(value, Mapping) and value.get("type") in _GEOJSON_TYPES:
        return earth.Area.from_geojson(dict(value), name=value.get("name") or name)
    own = get("name")
    label = own if isinstance(own, str) and own.strip() else name
    for key in ("geometry", "area", "geojson"):
        inner = get(key)
        if inner is not None:
            return _as_area(inner, label)
    return None


def lookup_place(user_id: str, place_id: str) -> earth.Area | None:
    """The saved place's area from the places service, when that service exists.

    Feature-detected (`app.services.places` with `get_place` or `get`); None when it is not
    installed, the place is unknown, or anything goes wrong (logged). Never the demo preset.
    """
    try:
        mod = importlib.import_module(PLACES_MODULE)
    except ModuleNotFoundError as exc:
        if exc.name == PLACES_MODULE:
            return None
        raise
    fn = getattr(mod, "get_place", None) or getattr(mod, "get", None)
    if not callable(fn):
        return None
    try:
        try:
            place = fn(user_id, place_id)
        except TypeError:
            place = fn(place_id)
        return _as_area(place)
    except Exception:  # noqa: BLE001 — a broken lookup means "no area", not a failed run
        log.warning("place lookup failed for a saved place", exc_info=True)
        return None


def memory_values(ctx: memory.MemoryContext) -> list[str]:
    """Every remembered value (never keys): the private list for the leak check."""
    out: list[str] = [*ctx.me.values()]
    for place in ctx.places.values():
        out.append(place.title)
        out += [p.value for p in place.profile.values()]
        out += [i.text for i in place.insights]
        out += [n.text for n in place.notes]
    return list(dict.fromkeys(v.strip() for v in out if v and v.strip()))


def _facts_summary(facts: earth.PlaceContext) -> str:
    """A compact JSON summary of `earth.describe` (shown to the model, number source)."""
    cover = sorted(facts.land_cover.items(), key=lambda kv: -kv[1])[:5]
    payload = {
        "name": facts.name,
        "country": facts.country,
        "area_ha": facts.area_ha,
        "land_cover": dict(cover),
        "elevation_m": facts.elevation_m,
        "slope_deg": facts.slope_deg,
        "rain_mm_30d": facts.rain_mm_30d,
        "recent_scenes": facts.recent_scenes,
        "warnings": facts.warnings[:4],
    }
    return harness.compact(payload, 1500)


def context_readings(facts: earth.PlaceContext) -> dict[str, Any]:
    """Static terrain from `earth.describe` as FINDINGS CONVENTION readings, so code scoring
    can check the cards' context signs (e.g. landslide "slope above 20") even when no script
    measured them (`AgentState.context_observed`). Slope is the outline mean, as the earth
    reference tells scripts. Rain is left out: the 30 days before today are not the days
    before the change."""
    observed: dict[str, Any] = {}
    if facts.slope_deg is not None:
        observed["slope_deg"] = {"value": facts.slope_deg.mean}
    return observed


def _setting_cards(kb: KnowledgeBase, facts: earth.PlaceContext | None) -> dict[str, str]:
    if facts is None:
        return {}
    shares = sorted(facts.land_cover.items(), key=lambda kv: -kv[1])
    codes = [
        _LAND_COVER_CODES[name]
        for name, share in shares
        if share >= MIN_LAND_COVER_SHARE and name in _LAND_COVER_CODES
    ]
    out: dict[str, str] = {}
    for card in kb.settings_for_land_cover(codes)[:MAX_SETTING_CARDS]:
        try:
            out[card.id] = prompts.card_text(kb, card.id)
        except KeyError:
            continue
    return out


# --- One run --------------------------------------------------------------------------------


def _free_id(taken: set[str], base: str) -> str:
    if base not in taken:
        return base
    n = 2
    while f"{base}_{n}" in taken:
        n += 1
    return f"{base}_{n}"


class _AgentRun:
    """The state of one run while it streams (a new run, or a resumed one)."""

    def __init__(
        self,
        *,
        run_id: str,
        user_id: str,
        provider: LLMProvider,
        kb: KnowledgeBase,
        state: AgentState,
        area: earth.Area | None,
        place_id: str | None,
        blocks: list[Block] | None = None,
        provenance: list[earth.Provenance] | None = None,
        call_summaries: list[str] | None = None,
        flags: Mapping[str, Any] | None = None,
    ) -> None:
        self.run_id = run_id
        self.provider = provider
        self.kb = kb
        self.state = state
        self.limits = Limits.from_settings()
        self.status: RunStatus | None = None
        self.nudged_cut = False
        self.nudged_text = False
        self.load_flags(flags)
        self.tctx = tools.ToolContext(
            run_id=run_id,
            user_id=user_id,
            state=state,
            kb=kb,
            area=area,
            place_id=place_id,
            limits=self.limits,
            blocks=list(blocks or []),
            provenance=list(provenance or []),
            call_summaries=list(call_summaries or []),
            save_script=self._save_script,
        )

    # -- accounting and persistence --

    def meter(self) -> tuple[int, float]:
        """(tokens, cost_usd) so far, for `done`."""
        usage = self.state.usage
        return usage.total_tokens, round(self.provider.cost_usd(usage), 6)

    def final_status(self) -> RunStatus | None:
        return self.status

    def _cost(self) -> Cost:
        u = self.state.usage
        return Cost(
            input_tokens=u.input_tokens + u.cache_read_tokens + u.cache_write_tokens,
            output_tokens=u.output_tokens,
            usd=round(self.provider.cost_usd(u), 6),
        )

    def load_flags(self, flags: Mapping[str, Any] | None) -> None:
        """Restore the nudge-once markers stored under `LOOP_KEY` (missing -> not nudged)."""
        if isinstance(flags, Mapping):
            self.nudged_cut = flags.get("nudged_cut") is True
            self.nudged_text = flags.get("nudged_text") is True

    def flags(self) -> dict[str, bool]:
        return {"nudged_cut": self.nudged_cut, "nudged_text": self.nudged_text}

    def _save_sync(self) -> None:
        run_store.update_params(self.run_id, {AGENT_KEY: self.state.dump(), LOOP_KEY: self.flags()})
        run_store.set_cost(self.run_id, self._cost())

    async def save(self) -> None:
        """Persist the state (resumable after a crash or a pause) and the cost so far."""
        await asyncio.to_thread(self._save_sync)

    async def _fresh_record(self) -> RunRecord:
        """The stored record with everything streamed so far (provenance stored first)."""
        await asyncio.to_thread(run_store.set_provenance, self.run_id, self.tctx.provenance)
        record = await asyncio.to_thread(run_store.get_run, self.run_id)
        if record is None:  # deleted mid-run: nothing sensible to build on
            raise RuntimeError(f"run {self.run_id} vanished from the store")
        return record

    def _taken_ids(self) -> set[str]:
        return {b.id for b in self.state.blocks} | {b.id for b in self.tctx.blocks}

    def _block_event(self, block: Block) -> BlockReady:
        if block.id not in {b.id for b in self.state.blocks}:
            self.state.blocks.append(BlockRef(id=block.id, type=block.type, title=block.title))
        if all(b.id != block.id for b in self.tctx.blocks):
            self.tctx.blocks.append(block)
        return BlockReady(block=block)

    # -- endings --

    async def _answer(self, answer: Answer, record: RunRecord) -> AsyncIterator[StreamEvent]:
        for block in answers.blocks_to_stream(answer, record):
            yield self._block_event(block)
        await self.save()
        # The record's method is what share links and reports publish: the answer's cards,
        # skill and script reference, not the bare model id set at the start.
        await asyncio.to_thread(run_store.set_method, self.run_id, answer.method)
        yield AnswerEvent(answer=answer)

    async def _save_script(self, script: str, params: dict[str, Any], block_ids: list[str]) -> None:
        """`ToolContext.save_script`: the last successful script and its exact params."""
        try:
            await asyncio.to_thread(run_store.set_script, self.run_id, script, params, block_ids)
        except (KeyError, ValueError):
            log.warning("run %s: could not save the script for refresh", self.run_id)

    async def finish(self, outcome: tools.ToolOutcome) -> AsyncIterator[StreamEvent]:
        """The answer for an accepted `finish` (code scoring decides the cause)."""
        st, kb = self.state, self.kb
        record = await self._fresh_record()
        if not st.data_read:
            answer = answers.general_answer(outcome.finished, st, kb, record)
        else:
            score = outcome.score
            if not isinstance(score, scoring.ScoreResult):
                try:
                    score = scoring.score(st, kb)
                except Exception:  # noqa: BLE001 — no score, no cause: template instead
                    log.exception("run %s: scoring failed at finish", self.run_id)
                    async for ev in self.template("error"):
                        yield ev
                    return
            answer = answers.build_answer(outcome.finished, st, score, kb, record)
        async for ev in self._answer(answer, record):
            yield ev

    async def template(self, reason: str) -> AsyncIterator[StreamEvent]:
        """A code-built, measure-only answer from what was measured so far."""
        st, kb = self.state, self.kb
        log.info("run %s: template answer (%s)", self.run_id, reason)
        record = await self._fresh_record()
        score = None
        if st.data_read:
            try:
                score = scoring.score(st, kb)
            except Exception:  # noqa: BLE001 — the template works without a score
                log.exception("run %s: scoring failed for the template answer", self.run_id)
        answer = answers.build_template_answer(st, record, reason, score=score, kb=kb)
        async for ev in self._answer(answer, record):
            yield ev

    async def refused(self, category: str | None) -> AsyncIterator[StreamEvent]:
        """The model declined: a `guard` event saying so (the frontend shows the latest
        guard), a generic `limits` block, then `done{refused}`."""
        log.warning("run %s: the model refused (category %s)", self.run_id, category)
        block = guard_mod.limits_block(
            self.kb, None, block_id=_free_id(self._taken_ids(), "limits")
        )
        self.status = "refused"
        self.state.guard = GuardVerdict(scope=REFUSAL_SCOPE, reason=MODEL_REFUSAL)
        yield GuardEvent(scope=REFUSAL_SCOPE, rule_id=None, reason=MODEL_REFUSAL)
        yield self._block_event(block)
        await self.save()

    # -- the loop --

    def _append_user(self, results: list[ToolResult], text: str | None = None) -> None:
        self.state.transcript.append(Message(role="user", text=text or None, tool_results=results))

    def _batch_note(self) -> str:
        """Text sent with a batch of tool results: the budget, and the last-turn nudge."""
        st = self.state
        note = harness.budget_line(st, self.limits)
        if st.turns + 1 >= self.limits.max_turns:
            note += " " + LAST_TURN_NUDGE
        return note

    async def _complete(self, system: list[str]) -> Turn:
        timeout = max(
            MIN_CALL_TIMEOUT_S, harness.time_left_s(self.state, self.limits) + CALL_GRACE_S
        )
        return await asyncio.wait_for(
            self.provider.complete(
                system=system,
                messages=self.state.transcript,
                tools=tools.TOOL_SPECS,
                max_tokens=settings.agent_turn_max_tokens,
                effort=TURN_EFFORT,
            ),
            timeout=timeout,
        )

    async def loop(self) -> AsyncIterator[StreamEvent]:
        """Model turns until an answer, a pause, a refusal or a cap (template answer)."""
        st = self.state
        system = prompts.build_system(self.kb)
        while True:
            cap = harness.loop_cap(st, self.limits)
            if cap is not None:
                log.info("run %s: %s", self.run_id, cap.detail)
                async for ev in self.template(cap.template_reason):
                    yield ev
                return
            try:
                # Before every model call: concurrent runs all count, once their cost is saved.
                await asyncio.to_thread(policy.check_spend_cap)
            except policy.SpendCapReached:
                async for ev in self.template("budget"):
                    yield ev
                return
            try:
                turn = await self._complete(system)
            except TimeoutError:
                log.warning("run %s: model call ran past the wall clock", self.run_id)
                async for ev in self.template("time"):
                    yield ev
                return
            except LLMError as exc:
                log.warning("run %s: model call failed: %s", self.run_id, exc.message)
                async for ev in self.template("error"):
                    yield ev
                return
            st.turns += 1
            st.usage = st.usage + turn.usage
            log.info(
                "run %s: turn %d stop=%s calls=%s usage=%s",
                self.run_id,
                st.turns,
                turn.stop,
                [c.name for c in turn.tool_calls],
                turn.usage.model_dump(),
            )
            st.transcript.append(turn.to_message(self.provider.name))
            await self.save()

            if turn.stop == "refusal":
                async for ev in self.refused(turn.refusal_category):
                    yield ev
                return
            if turn.stop == "max_tokens":
                if self.nudged_cut:
                    async for ev in self.template("error"):
                        yield ev
                    return
                self.nudged_cut = True
                results = [harness.tool_error(c.id, _NOT_RUN) for c in turn.tool_calls]
                self._append_user(results, f"{_CUT_OFF} {self._batch_note()}")
                await self.save()
                continue
            if not turn.tool_calls:
                if self.nudged_text:
                    async for ev in self.template("error"):
                        yield ev
                    return
                self.nudged_text = True
                self._append_user([], f"{_NO_TOOL} {self._batch_note()}")
                await self.save()
                continue

            results: list[ToolResult] = []
            held: list[StreamEvent] = []
            pause = False
            finished: tools.ToolOutcome | None = None
            end: harness.CapHit | None = None
            for call in turn.tool_calls:
                outcome: tools.ToolOutcome | None = None
                async for item in tools.iter_handle(call, self.tctx):
                    if isinstance(item, tools.ToolOutcome):
                        outcome = item
                    else:
                        yield item
                if outcome is None:  # iter_handle always ends with the outcome
                    outcome = tools.ToolOutcome(
                        harness.tool_error(call.id, "The tool did not return a result.")
                    )
                results.append(outcome.result)
                held.extend(outcome.events)
                pause = pause or outcome.pause
                if outcome.finished is not None:
                    finished = outcome
                    break  # nothing else from the batch runs after an accepted finish
                end = end or outcome.end_reason

            if finished is not None:
                async for ev in self.finish(finished):
                    yield ev
                return
            if pause:
                st.pending_results = results
                await self.save()
                await asyncio.to_thread(run_store.set_provenance, self.run_id, self.tctx.provenance)
                for ev in held:  # clarification_needed: the last event before `done`
                    yield ev
                return
            if end is not None:
                async for ev in self.template(end.template_reason):
                    yield ev
                return
            self._append_user(results, self._batch_note())
            await self.save()


# --- Start ----------------------------------------------------------------------------------


def _redirect_answer(outcome: guard_mod.GuardOutcome, block: Block) -> Answer:
    """The short template answer of a redirect rule (no analysis, no LLM text)."""
    method = Method(model=None)
    message = " ".join((outcome.message or guard_mod.GENERIC_REFUSAL).split())
    return Answer(
        kind="general",
        title="This needs a different kind of help",
        sentence=message,
        confidence=Confidence(
            level="High", pct=90, note="A fixed policy reply, not an analysis of the place."
        ),
        caveats=[],
        blocks=[block.model_copy(update={"primary": True})],
        followups=list(outcome.followups[:3]),
        method=method,
        hash=answers.answer_hash(method, ()),
    )


async def _guard(
    provider: LLMProvider, kb: KnowledgeBase, question: str, area: earth.Area | None
) -> guard_mod.GuardResult:
    """Code gates (area size, military overlap) first, then the guard call (which runs the
    injection pre-check itself). The guard sees only code facts, never memory."""
    if area is not None:
        hit = policy.size_gate(area.area_ha, kb) or policy.military_overlap(area)
        if hit is not None:
            return guard_mod.result_from_hit(hit, kb)
    facts = {"name": area.name, "area_ha": round(area.area_ha, 2)} if area is not None else None
    return await guard_mod.run_guard(provider, question, facts, kb)


async def _new_run_body(
    run: _AgentRun, req: RunRequest, thread_id: str, user_id: str
) -> AsyncIterator[StreamEvent]:
    st, kb = run.state, run.kb
    area = run.tctx.area
    yield RunStarted(run_id=run.run_id, thread_id=thread_id)

    try:
        result = await asyncio.wait_for(
            _guard(run.provider, kb, req.question, area), timeout=GUARD_TIMEOUT_S
        )
    except (LLMError, TimeoutError) as exc:
        why = exc.message if isinstance(exc, LLMError) else "timed out"
        log.warning("run %s: guard call failed: %s", run.run_id, why)
        run.status = "failed"
        retry = exc.retryable if isinstance(exc, LLMError) else True
        yield ErrorEvent(message=_LLM_DOWN, recoverable=retry, kind="llm_unavailable")
        return
    st.usage = st.usage + result.usage
    outcome = guard_mod.guard_outcome(result, kb, block_id="limits")
    st.guard = outcome.verdict()
    await run.save()
    yield outcome.event()
    if outcome.action != "continue":
        if outcome.block is None:  # defensive: guard_outcome always sets one
            outcome.block = guard_mod.limits_block(kb, outcome.rule_id, block_id="limits")
        yield run._block_event(outcome.block)
        if outcome.action == "refuse":
            run.status = "refused"
            await run.save()
            return
        await run.save()
        yield AnswerEvent(answer=_redirect_answer(outcome, outcome.block))
        return

    # Ground: place facts (a visible step), setting cards, memory (untrusted data).
    facts: earth.PlaceContext | None = None
    if area is not None:
        steps = EarthSteps(run.run_id, start=st.step_index)
        try:
            async for ev in steps.run(
                "Look up the place",
                "Size, land cover, terrain and recent satellite passes",
                earth.describe,
                area,
            ):
                yield ev
            facts = steps.result
        except Exception as exc:  # noqa: BLE001 — the loop can still work without facts
            log.warning("run %s: describe failed: %s", run.run_id, getattr(exc, "kind", exc))
        st.step_index = steps.index
        run.tctx.provenance.extend(steps.provenance)
        st.place = PlaceInfo(
            name=(facts.name if facts else None) or area.name,
            area_ha=facts.area_ha if facts else area.area_ha,
            facts=_facts_summary(facts) if facts else None,
        )
        if facts is not None:
            st.context_observed = context_readings(facts)
    place_ids = [req.place_id] if req.place_id else []
    memory_prompt: str | None = None
    try:
        mctx = await asyncio.to_thread(memory.load_context, user_id, place_ids)
    except (ValueError, OSError):
        log.warning("run %s: could not read the user's memory", run.run_id, exc_info=True)
        mctx = None
    if mctx is not None and (mctx.me or mctx.places):
        memory_prompt = mctx.as_prompt()
        st.memory_values = memory_values(mctx)

    text = prompts.build_first_message(
        req.question,
        req.lang,
        place=st.place,
        place_facts=facts,
        setting_cards=_setting_cards(kb, facts),
        memory_prompt=memory_prompt,
        guard_note=outcome.note,
        has_area=area is not None,
    )
    if req.skill_id and req.skill_id in skill_lib.skill_ids():
        text += (
            f"\n- The user picked the skill '{req.skill_id}': use run_skill with it if it fits "
            "the question."
        )
    run._append_user([], text)
    # The agent's wall clock starts now: the guard and the grounding are not its time.
    st.started_at = datetime.now(UTC)
    await run.save()
    async for ev in run.loop():
        yield ev


async def stream_agent_run(
    req: RunRequest,
    user_id: str,
    provider: LLMProvider,
    *,
    thread_id: str | None = None,
    kb: KnowledgeBase | None = None,
) -> AsyncIterator[StreamEvent]:
    """Stream (and store) a new agent run for `req`, ending with exactly one `done`.

    The area comes from `req.area`, else the saved place (`lookup_place`), else none: the
    model then works without an outline (it may search for the place or ask). Never the
    demo preset.
    """
    kb = kb or _default_kb()
    run_id = new_run_id()
    thread_id = thread_id or req.thread_id or new_thread_id()
    area: earth.Area | None = None
    if req.area is not None:
        try:
            area = req.area.to_area()
        except earth.EarthError:
            area = None  # the route already answered 400 for a bad area
    if area is None and req.place_id:
        area = await asyncio.to_thread(lookup_place, user_id, req.place_id)
    state = AgentState(provider=provider.name, model=provider.model)
    record = RunRecord(
        run_id=run_id,
        thread_id=thread_id,
        user_id=user_id,
        place_ids=[req.place_id] if req.place_id else [],
        question=req.question,
        lang=req.lang,
        area=area,
        status="running",
        method=Method(model=provider.model),
        params={AGENT_KEY: state.dump(), "skill_id": req.skill_id},
        provider=provider.name,
        model=provider.model,
    )
    await asyncio.to_thread(run_store.save_run, record)
    run = _AgentRun(
        run_id=run_id,
        user_id=user_id,
        provider=provider,
        kb=kb,
        state=state,
        area=area,
        place_id=req.place_id,
    )
    body = _new_run_body(run, req, thread_id, user_id)
    policy.RUN_SLOTS.enter()
    try:
        async for ev in drive(run_id, body, meter=run.meter, final_status=run.final_status):
            yield ev
    finally:
        policy.RUN_SLOTS.leave()


async def stream_unavailable(
    req: RunRequest,
    user_id: str,
    *,
    kind: str,
    message: str,
    thread_id: str | None = None,
) -> AsyncIterator[StreamEvent]:
    """An honest ending when the agent cannot run for this request's place (no provider,
    `AGENT_MODE=preset`, the daily spend cap): `run_started`, an `error` with `kind`, then
    `done{failed}`. Used instead of the demo preset, which is about another place."""
    run_id = new_run_id()
    thread_id = thread_id or req.thread_id or new_thread_id()
    area: earth.Area | None = None
    if req.area is not None:
        try:
            area = req.area.to_area()
        except earth.EarthError:
            area = None
    record = RunRecord(
        run_id=run_id,
        thread_id=thread_id,
        user_id=user_id,
        place_ids=[req.place_id] if req.place_id else [],
        question=req.question,
        lang=req.lang,
        area=area,
        status="running",
    )
    await asyncio.to_thread(run_store.save_run, record)

    async def body() -> AsyncIterator[StreamEvent]:
        yield RunStarted(run_id=run_id, thread_id=thread_id)
        yield ErrorEvent(message=message, recoverable=False, kind=kind)

    async for ev in drive(run_id, body(), final_status=lambda: "failed"):
        yield ev


# --- Resume ---------------------------------------------------------------------------------


def _last_card(record: RunRecord) -> ClarificationNeeded | None:
    """The run's latest clarification card."""
    for ev in reversed(record.events):
        if isinstance(ev, ClarificationNeeded):
            return ev
    return None


def _last_asked(record: RunRecord) -> list[str]:
    """Keys of the run's latest clarification card."""
    card = _last_card(record)
    return [q.key for q in card.questions] if card else []


def answer_values(answers: Mapping[str, str], card: ClarificationNeeded | None) -> list[str]:
    """The user's answers to keep private (`AgentState.memory_values`): every value except
    one that is exactly an option the model itself offered (its own words, already shown on
    the card). Kept whether or not `remember` was set: the answers are the user's input."""
    offered = {
        " ".join(o.split()).casefold() for q in (card.questions if card else []) for o in q.options
    }
    values = (" ".join(str(v).split()) for v in answers.values())
    return list(dict.fromkeys(v for v in values if v and v.casefold() not in offered))


async def _resume_body(
    run: _AgentRun,
    answered: ClarificationAnswered,
    asked: list[str],
    card: ClarificationNeeded | None = None,
) -> AsyncIterator[StreamEvent]:
    st = run.state
    for value in answer_values(answered.answers, card):
        if value not in st.memory_values:
            st.memory_values.append(value)
    try:
        results = tools.resume_results(st, answered.answers, asked)
    except ValueError:
        log.warning("run %s: reply to a run with no pending question", run.run_id)
        run.status = "failed"
        yield ErrorEvent(message="This run cannot continue.", recoverable=False)
        return
    # The user's think time is not the agent's: the wall clock starts again.
    st.started_at = datetime.now(UTC)
    run._append_user(results, run._batch_note())
    await run.save()
    async for ev in run.loop():
        yield ev


async def resume_agent_run(
    record: RunRecord,
    answered: ClarificationAnswered,
    provider: LLMProvider,
    *,
    kb: KnowledgeBase | None = None,
) -> AsyncIterator[StreamEvent]:
    """Continue an agent run after its clarification reply (`apply_reply` already stored
    `answered` and set the run `running`): sends `answered` first, then the rest of the run.

    The answers become the `ask_user` tool result (with the batch's other results held back
    at the pause) in one user message; step indexes continue from the stored state.
    """
    kb = kb or _default_kb()
    state = AgentState.load(record)
    if state is None:
        raise ValueError(f"run {record.run_id} has no agent state")
    run = _AgentRun(
        run_id=record.run_id,
        user_id=record.user_id,
        provider=provider,
        kb=kb,
        state=state,
        area=record.area,
        place_id=record.place_ids[0] if record.place_ids else None,
        blocks=list(record.blocks),
        provenance=list(record.provenance),
        call_summaries=[s.result for s in record.steps if s.result],
        flags=record.params.get(LOOP_KEY),
    )
    body = _resume_body(run, answered, _last_asked(record), _last_card(record))
    policy.RUN_SLOTS.enter()
    try:
        async for ev in drive(
            record.run_id, body, (answered,), meter=run.meter, final_status=run.final_status
        ):
            yield ev
    finally:
        policy.RUN_SLOTS.leave()
