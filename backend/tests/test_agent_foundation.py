"""A3 foundation: LLM types, FakeProvider, provider selection, agent state, run store
helpers, the shared run driver and the `live` marker. Offline; never calls a real LLM."""

from __future__ import annotations

import asyncio
import json
import sys
import types
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import settings
from app.schemas.answer import Method
from app.schemas.runs import Cost, RunRecord, RunRequest
from app.schemas.stream import ExpectationRow, RunStarted, StreamEvent
from app.services import preset_run, run_driver
from app.services import runs as run_store
from app.services.agent import llm
from app.services.agent.llm import (
    LLMError,
    LLMProvider,
    Message,
    ProviderUnavailable,
    ToolCall,
    ToolResult,
    ToolSpec,
    Turn,
    Usage,
    available_providers,
    get_provider,
    set_provider_override,
)
from app.services.agent.llm.fake import FakeProvider, text_turn, tool_turn
from app.services.agent.state import (
    AGENT_KEY,
    AgentState,
    BlockRef,
    GuardVerdict,
    PlaceInfo,
    ScriptRun,
)
from app.services.sandbox import ScriptError
from tests.conftest import live_skip_reason

CLAUDE_MODULE = "app.services.agent.llm.claude"
T0 = datetime(2026, 10, 3, 9, 0, tzinfo=UTC)

#: What a Claude assistant turn's raw payload looks like (content blocks incl. thinking).
RAW = [
    {"type": "thinking", "thinking": "", "signature": "sig-abc"},
    {"type": "text", "text": "Reading the card first."},
    {"type": "tool_use", "id": "toolu_1", "name": "read_card", "input": {"card_id": "seasonal"}},
]


@pytest.fixture
def db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("EARTH_IMPL", "stub")
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path / "data"))
    path = tmp_path / "runs.sqlite"
    monkeypatch.setenv("RUNS_DB_PATH", str(path))
    return path


def _record(run_id: str = "r_a1", user_id: str = "demo", **kw) -> RunRecord:
    return RunRecord(
        run_id=run_id,
        thread_id="t_a1",
        user_id=user_id,
        question="Has anything changed here?",
        status="running",
        **kw,
    )


def _spec(name: str = "read_card") -> ToolSpec:
    return ToolSpec(
        name=name,
        description="Read a knowledge card.",
        input_schema={
            "type": "object",
            "properties": {"card_id": {"type": "string"}},
            "required": ["card_id"],
            "additionalProperties": False,
        },
    )


async def _complete(p: LLMProvider, messages: list[Message]) -> Turn:
    return await p.complete(
        system=["rules"], messages=messages, tools=[_spec()], max_tokens=100, effort="low"
    )


# --- Base types ---------------------------------------------------------------------------------


def test_usage_add_and_total() -> None:
    a = Usage(input_tokens=1, output_tokens=2, cache_read_tokens=3, cache_write_tokens=4)
    b = Usage(input_tokens=10, output_tokens=20, cache_read_tokens=30, cache_write_tokens=40)
    total = a + b
    assert total == Usage(
        input_tokens=11, output_tokens=22, cache_read_tokens=33, cache_write_tokens=44
    )
    assert total.total_tokens == 110
    assert a.input_tokens == 1  # operands untouched
    assert sum([a, b], Usage()) == total
    with pytest.raises(TypeError):
        _ = a + 1  # type: ignore[operator]


def test_turn_to_message_keeps_raw_and_calls() -> None:
    turn = Turn(
        text="",
        tool_calls=[ToolCall(id="toolu_1", name="read_card", args={"card_id": "seasonal"})],
        stop="tool_use",
        usage=Usage(input_tokens=5),
        raw=RAW,
    )
    msg = turn.to_message("claude")
    assert msg.role == "assistant" and msg.provider == "claude"
    assert msg.text is None  # empty text is no text
    assert msg.raw == RAW and msg.tool_results == []
    assert msg.tool_calls == turn.tool_calls
    msg.tool_calls[0].args["card_id"] = "changed"
    assert turn.tool_calls[0].args["card_id"] == "seasonal"  # a copy, not shared
    assert Turn(text="Done.", stop="end").to_message("fake").text == "Done."


def test_message_json_round_trip_with_raw() -> None:
    msgs = [
        Message(role="user", text="Has anything changed here?"),
        Turn(
            text="Reading the card first.",
            tool_calls=[ToolCall(id="toolu_1", name="read_card", args={"card_id": "seasonal"})],
            stop="tool_use",
            raw=RAW,
        ).to_message("claude"),
        Message(
            role="user",
            tool_results=[ToolResult(call_id="toolu_1", content='{"id": "seasonal"}')],
        ),
    ]
    for m in msgs:
        again = Message.model_validate_json(m.model_dump_json())
        assert again == m
        assert Message.model_validate(json.loads(json.dumps(m.model_dump(mode="json")))) == m
    assert msgs[1].model_dump(mode="json")["raw"][0]["signature"] == "sig-abc"


def test_turn_stop_is_checked() -> None:
    with pytest.raises(ValidationError):
        Turn(text="x", stop="stop_sequence")  # type: ignore[arg-type]


def test_llm_error_retryable() -> None:
    err = LLMError("rate limited", retryable=True)
    assert err.retryable and err.message == "rate limited" and str(err) == "rate limited"
    assert LLMError("bad request").retryable is False


# --- FakeProvider -------------------------------------------------------------------------------


def test_fake_provider_scripted_turns_and_recording() -> None:
    seen: list[list[Message]] = []

    def second(messages: list[Message]) -> Turn:
        seen.append(messages)
        return text_turn(f"{len(messages)} messages so far", usage=Usage(output_tokens=7))

    first = tool_turn(("read_card", {"card_id": "seasonal"}), text="Let me check.")
    fake = FakeProvider(turns=[first, second])
    assert isinstance(fake, LLMProvider)
    assert (fake.name, fake.model) == ("fake", "fake-1")

    transcript = [Message(role="user", text="question")]
    t1 = asyncio.run(_complete(fake, transcript))
    assert t1.stop == "tool_use" and t1.tool_calls[0].name == "read_card"
    assert t1.tool_calls[0].id.startswith("toolu_fake_")
    transcript.append(t1.to_message(fake.name))
    t2 = asyncio.run(_complete(fake, transcript))
    assert t2.text == "2 messages so far" and t2.stop == "end"
    assert t2.usage.output_tokens == 7
    assert [len(m) for m in seen] == [2]

    assert [c.kind for c in fake.calls] == ["complete", "complete"]
    call = fake.calls[0]
    assert call.system == ["rules"] and call.effort == "low" and call.max_tokens == 100
    assert [t.name for t in call.tools] == ["read_card"]
    assert len(call.messages) == 1  # a snapshot: later appends don't change it
    assert fake.remaining == (0, 0)


def test_fake_provider_returns_copies() -> None:
    turn = tool_turn(("read_card", {"card_id": "seasonal"}))
    fake = FakeProvider(turns=[turn])
    got = asyncio.run(_complete(fake, []))
    got.tool_calls[0].args["card_id"] = "changed"
    assert turn.tool_calls[0].args["card_id"] == "seasonal"


def test_tool_turn_ids_are_unique() -> None:
    turn = tool_turn(("read_card", {"card_id": "a"}), ("read_card", {"card_id": "b"}))
    other = tool_turn(("read_card", {"card_id": "c"}))
    ids = [c.id for c in [*turn.tool_calls, *other.tool_calls]]
    assert len(set(ids)) == 3


def test_fake_provider_exhaustion_raises() -> None:
    fake = FakeProvider(turns=[text_turn("only one")])
    asyncio.run(_complete(fake, []))
    with pytest.raises(AssertionError, match="ran out of scripted turns"):
        asyncio.run(_complete(fake, []))
    assert len(fake.calls) == 2  # the failing call is still recorded


def test_fake_provider_json_script() -> None:
    fake = FakeProvider(
        json=[
            {"scope": "answerable", "rule_id": None, "reason": None},
            lambda user: {"echo": user},
            {"_refusal": "cyber"},
        ]
    )

    async def ask(user: str) -> tuple[dict, Usage]:
        return await fake.complete_json(
            system=["guard"], user=user, schema={"type": "object"}, max_tokens=50, effort="low"
        )

    assert asyncio.run(ask("q1"))[0]["scope"] == "answerable"
    data, usage = asyncio.run(ask("q2"))
    assert data == {"echo": "q2"} and usage == Usage()
    assert asyncio.run(ask("q3"))[0] == {"_refusal": "cyber"}
    assert [c.user for c in fake.calls] == ["q1", "q2", "q3"]
    assert fake.calls[0].json_schema == {"type": "object"}
    with pytest.raises(AssertionError, match="ran out of scripted JSON"):
        asyncio.run(ask("q4"))


def test_fake_provider_cost() -> None:
    fake = FakeProvider()
    assert fake.cost_usd(Usage()) == 0.0
    assert fake.cost_usd(Usage(input_tokens=600_000, output_tokens=400_000)) == pytest.approx(1.0)


# --- Provider selection -------------------------------------------------------------------------


def test_tests_default_to_the_fake_provider() -> None:
    """The autouse conftest fixture: fake allowed and default, no API key visible."""
    assert settings.allow_fake_provider is True and settings.llm_provider == "fake"
    assert settings.anthropic_api_key is None
    assert isinstance(get_provider(), FakeProvider)
    assert isinstance(get_provider("fake"), FakeProvider)
    assert available_providers() == ["fake"]


def test_fake_provider_is_gated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "allow_fake_provider", False)
    with pytest.raises(ProviderUnavailable, match="tests only"):
        get_provider("fake")
    with pytest.raises(ProviderUnavailable):
        get_provider()  # settings.llm_provider is "fake" in tests
    assert available_providers() == []


@pytest.mark.parametrize("key", [None, "", "   "])
def test_claude_needs_a_key(monkeypatch: pytest.MonkeyPatch, key: str | None) -> None:
    monkeypatch.setattr(settings, "anthropic_api_key", None if key is None else SecretStr(key))
    with pytest.raises(ProviderUnavailable, match="ANTHROPIC_API_KEY"):
        get_provider("claude")
    assert "claude" not in available_providers()


def test_claude_is_built_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """With a key, `claude` is built by `llm.claude.ClaudeProvider` (stubbed: no network)."""

    class StubClaude:
        name = "claude"

        def __init__(self, *, api_key: str, model: str, fallbacks: bool) -> None:
            self.api_key, self.model, self.fallbacks = api_key, model, fallbacks

    stub = types.ModuleType(CLAUDE_MODULE)
    stub.ClaudeProvider = StubClaude  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, CLAUDE_MODULE, stub)
    monkeypatch.setattr(settings, "anthropic_api_key", SecretStr("  sk-test-not-real  "))
    monkeypatch.setattr(settings, "llm_provider", "claude")
    monkeypatch.setattr(settings, "llm_fallbacks", False)

    provider = get_provider()
    assert isinstance(provider, StubClaude)
    assert provider.api_key == "sk-test-not-real"
    assert provider.model == settings.claude_model == "claude-opus-5-5"
    assert provider.fallbacks is False
    assert available_providers() == ["claude", "fake"]


def test_claude_module_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, CLAUDE_MODULE, None)  # import fails: module missing
    monkeypatch.setattr(settings, "anthropic_api_key", SecretStr("sk-test-not-real"))
    with pytest.raises(ProviderUnavailable, match="not installed"):
        get_provider("claude")
    assert "claude" not in available_providers()


def test_unknown_provider() -> None:
    with pytest.raises(ProviderUnavailable, match="Unknown LLM provider"):
        get_provider("gpt")


def test_provider_override() -> None:
    fake = FakeProvider(name="scripted")
    set_provider_override(fake)
    assert get_provider() is fake
    assert get_provider("claude") is fake  # no key needed: nothing reaches the API
    assert get_provider("scripted") is fake
    with pytest.raises(ProviderUnavailable):
        get_provider("gpt")
    assert available_providers() == ["claude", "fake", "scripted"]
    set_provider_override(None)
    assert get_provider() is not fake


def test_settings_defaults() -> None:
    """Defaults from the frozen interface (fresh Settings, ignoring the local .env)."""
    fresh = type(settings)(_env_file=None)
    assert fresh.llm_provider == "claude" and fresh.claude_model == "claude-opus-5-5"
    assert fresh.llm_fallbacks is True and fresh.allow_fake_provider is False
    assert fresh.agent_mode == "agent"
    assert (fresh.agent_max_turns, fresh.agent_max_code_runs) == (12, 6)
    assert fresh.agent_wall_clock_s == 150.0 and fresh.daily_spend_cap_usd == 20.0
    assert fresh.run_cooldown_s == 3.0
    assert (fresh.agent_turn_max_tokens, fresh.guard_max_tokens) == (16000, 4000)


# --- Contract additions -------------------------------------------------------------------------


def test_contract_additions() -> None:
    assert RunRequest(question="q").provider is None
    assert RunRequest(question="q", provider="claude").provider == "claude"
    with pytest.raises(ValidationError):
        RunRequest(question="q", provider="gpt")  # type: ignore[arg-type]
    rec = _record(provider="claude", model="claude-opus-5-5", method=Method(model="m-1"))
    again = RunRecord.model_validate_json(rec.model_dump_json())
    assert (again.provider, again.model, again.method.model) == ("claude", "claude-opus-5-5", "m-1")
    plain = _record()
    assert plain.provider is None and plain.model is None and plain.method.model is None


# --- Agent state --------------------------------------------------------------------------------


def _state() -> AgentState:
    turn = Turn(
        text="Reading the card first.",
        tool_calls=[ToolCall(id="toolu_1", name="read_card", args={"card_id": "seasonal"})],
        stop="tool_use",
        usage=Usage(input_tokens=100, output_tokens=20, cache_read_tokens=900),
        raw=RAW,
    )
    return AgentState(
        provider="claude",
        model="claude-opus-5-5",
        transcript=[Message(role="user", text="Has anything changed here?"), turn.to_message("c")],
        turns=1,
        code_runs=1,
        asks=1,
        hypotheses=["pond_filling", "seasonal"],
        post_hoc=["water_loss"],
        expectation_table=[ExpectationRow(hypothesis="pond_filling", expected={"water": "↓"})],
        cards_read=["pond_filling"],
        scripts=[
            ScriptRun(
                index=1,
                kind="code",
                script="def run(area, name=None):\n    return {}\n",
                params={"years": 4},
                ok=False,
                error=ScriptError(kind="crash", message="boom", hint="check the area"),
            ),
            ScriptRun(index=2, kind="skill", skill_id="pond-filling-check", ok=True),
        ],
        findings={"observed": {"water": {"before": 0.3, "after": 0.1, "delta": -0.2}}},
        evidence=[{"scene": "S2A_1", "cloud": 0.02}],
        notes=["Two clear passes."],
        blocks=[BlockRef(id="b1", type="then_now", title="Water, then and now")],
        pending_results=[ToolResult(call_id="toolu_2", content='{"ok": true}')],
        pending_ask_call_id="toolu_3",
        usage=turn.usage,
        place=PlaceInfo(name="Hoo Hok Wai", area_ha=38.2, facts="Fish ponds, flat."),
        memory_values=["Fish ponds"],
        guard=GuardVerdict(scope="answerable"),
        step_index=7,
        started_at=T0,
    )


def test_agent_state_round_trip_through_record(db: Path) -> None:
    state = _state()
    run_store.save_run(_record(params={"preset": False, AGENT_KEY: state.dump()}))
    stored = run_store.get_run("r_a1")
    assert stored is not None
    loaded = AgentState.load(stored)
    assert loaded == state
    assert loaded.transcript[1].raw == RAW and loaded.transcript[1].provider == "c"
    assert loaded.scripts[0].error is not None and loaded.scripts[0].error.kind == "crash"
    assert loaded.data_read is True
    json.dumps(state.dump())  # plain JSON


def test_agent_state_via_update_params(db: Path) -> None:
    run_store.save_run(_record(params={"preset": False, "answers": {"use": "Fish ponds"}}))
    state = _state()
    rec = run_store.update_params("r_a1", {AGENT_KEY: state})  # a model is stored as JSON
    assert rec.params["answers"] == {"use": "Fish ponds"} and rec.params["preset"] is False
    assert isinstance(rec.params[AGENT_KEY], dict)
    stored = run_store.get_run("r_a1")
    assert stored is not None and AgentState.load(stored) == state


def test_agent_state_load_missing_and_defaults() -> None:
    assert AgentState.load(_record()) is None
    fresh = AgentState(provider="fake", model="fake-1")
    assert fresh.turns == fresh.code_runs == fresh.asks == fresh.step_index == 0
    assert fresh.usage == Usage() and fresh.guard is None and fresh.data_read is False
    assert fresh.started_at.tzinfo is not None
    assert AgentState.model_validate(fresh.dump()) == fresh


def test_merge_findings() -> None:
    state = AgentState(provider="fake", model="fake-1")
    state.merge_findings({"observed": {"water": {"value": 0.1}, "greenness": {"delta": 0.2}}})
    state.merge_findings({"observed": {"water": {"value": 0.3}}, "extra": 1})
    state.merge_findings({"observed": None, "other": "x"})
    assert state.findings == {
        "observed": {"water": {"value": 0.3}, "greenness": {"delta": 0.2}},
        "extra": 1,
        "other": "x",
    }


# --- Run store helpers --------------------------------------------------------------------------


def test_get_owned_run(db: Path) -> None:
    run_store.save_run(_record(user_id="alice"))
    owned = run_store.get_owned_run("r_a1", "alice")
    assert owned is not None and owned.user_id == "alice"
    assert run_store.get_owned_run("r_a1", "bob") is None
    assert run_store.get_owned_run("r_missing", "alice") is None
    with pytest.raises(run_store.RunStoreError):
        run_store.get_owned_run("../etc", "alice")
    with pytest.raises(run_store.RunStoreError):
        run_store.get_owned_run("r_a1", "Not Valid")


def test_spent_usd_since(db: Path) -> None:
    assert run_store.spent_usd_since(T0 - timedelta(days=1)) == 0.0
    run_store.save_run(_record("r_old", created_at=T0 - timedelta(days=2), cost=Cost(usd=5.0)))
    run_store.save_run(_record("r_new1", user_id="bob", created_at=T0, cost=Cost(usd=0.25)))
    run_store.save_run(_record("r_new2", created_at=T0 + timedelta(hours=1)))  # no cost yet
    run_store.save_run(_record("r_new3", created_at=T0 + timedelta(hours=2), cost=Cost(usd=0.5)))
    assert run_store.spent_usd_since(T0 - timedelta(days=1)) == pytest.approx(0.75)
    assert run_store.spent_usd_since(T0 - timedelta(days=3)) == pytest.approx(5.75)
    assert run_store.spent_usd_since(T0.replace(tzinfo=None)) == pytest.approx(0.75)  # naive=UTC
    assert run_store.spent_usd_since(T0 + timedelta(days=1)) == 0.0


def test_update_params_merges(db: Path) -> None:
    run_store.save_run(_record(params={"a": 1, "nested": {"x": 1}}))
    rec = run_store.update_params("r_a1", {"b": 2, "nested": {"y": 2}})
    assert rec.params == {"a": 1, "b": 2, "nested": {"y": 2}}  # top-level keys replaced
    stored = run_store.get_run("r_a1")
    assert stored is not None and stored.params == rec.params
    with pytest.raises(KeyError):
        run_store.update_params("r_missing", {"a": 1})


def test_set_cost(db: Path) -> None:
    run_store.save_run(_record())
    run_store.set_cost("r_a1", Cost(input_tokens=10, output_tokens=5, usd=0.125))
    stored = run_store.get_run("r_a1")
    assert stored is not None and stored.cost == Cost(input_tokens=10, output_tokens=5, usd=0.125)
    assert run_store.spent_usd_since(T0 - timedelta(days=3650)) == pytest.approx(0.125)
    with pytest.raises(KeyError):
        run_store.set_cost("r_missing", Cost())


# --- Shared run driver --------------------------------------------------------------------------


def test_preset_aliases_point_at_the_driver() -> None:
    assert preset_run._drive is run_driver.drive
    assert preset_run._Steps is run_driver.EarthSteps
    assert preset_run._EARTH_LOCK is run_driver.EARTH_LOCK
    assert preset_run._release_earth is run_driver.release_earth


def _drive_events(run_id: str, **hooks) -> list[StreamEvent]:
    async def body() -> AsyncIterator[StreamEvent]:
        yield RunStarted(run_id=run_id, thread_id="t_a1")

    async def collect() -> list[StreamEvent]:
        return [ev async for ev in run_driver.drive(run_id, body(), **hooks)]

    return asyncio.run(collect())


def test_drive_defaults_unchanged(db: Path) -> None:
    run_store.save_run(_record())
    evs = _drive_events("r_a1")
    assert [e.event for e in evs] == ["run_started", "done"]
    done = evs[-1]
    assert done.status == "done" and done.tokens == 0 and done.cost_usd == 0.0


def test_drive_meter_and_final_status(db: Path) -> None:
    run_store.save_run(_record())
    evs = _drive_events("r_a1", meter=lambda: (1234, 0.0425), final_status=lambda: "refused")
    done = evs[-1]
    assert (done.status, done.tokens, done.cost_usd) == ("refused", 1234, 0.0425)
    stored = run_store.get_run("r_a1")
    assert stored is not None and stored.status == "refused"
    assert [e.event for e in stored.events] == ["run_started", "done"]


def test_drive_hooks_never_break_done(db: Path) -> None:
    run_store.save_run(_record())

    def broken() -> tuple[int, float]:
        raise RuntimeError("meter down")

    evs = _drive_events("r_a1", meter=broken, final_status=lambda: None)
    assert [e.event for e in evs] == ["run_started", "done"]
    assert evs[-1].status == "done" and evs[-1].tokens == 0


# --- live marker --------------------------------------------------------------------------------


def test_live_skip_reason() -> None:
    assert "pytest -m live" in (live_skip_reason("", key_configured=True) or "")
    assert live_skip_reason("not live", key_configured=True) is not None
    assert live_skip_reason("not world", key_configured=True) is not None
    assert "ANTHROPIC_API_KEY" in (live_skip_reason("live", key_configured=False) or "")
    assert live_skip_reason("live", key_configured=True) is None
    assert live_skip_reason("live and not world", key_configured=True) is None


def test_live_items_are_skipped_offline(request: pytest.FixtureRequest) -> None:
    """Without `-m live` (and a key) every collected `live` test carries a skip marker."""
    if live_skip_reason(request.config.getoption("-m") or "", key_configured=False) is None:
        pytest.skip("this session selected live tests")
    live = [i for i in request.session.items if i.get_closest_marker("live")]
    assert all(any(m.name == "skip" for m in i.iter_markers()) for i in live)


@pytest.mark.live
def test_live_tests_keep_the_real_settings() -> None:
    """Runs only with `pytest -m live` and a key: the autouse fixture leaves settings alone
    (no Claude call here; real-API tests live with the Claude provider)."""
    assert settings.anthropic_api_key is not None
    assert settings.llm_provider == type(settings)().llm_provider  # not forced to "fake"
    assert llm.KNOWN_PROVIDERS == ("claude", "fake")
