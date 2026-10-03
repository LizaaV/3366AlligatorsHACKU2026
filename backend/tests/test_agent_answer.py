"""A3 answer builder (docs/API.md section 5): place, measure-only, template and general
answers built by code from the finish call, the scoring and the run record. Offline, no LLM."""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import replace
from datetime import date
from typing import Any

import pytest
from pydantic import BaseModel

import earth
from app.schemas.answer import Answer
from app.schemas.runs import RunRecord, Step
from app.services.agent.answer import (
    CATEGORY_COLORS,
    DEFAULT_COLOR,
    MAX_PROOF,
    TEMPLATE_REASONS,
    FinishArgs,
    answer_hash,
    blocks_to_stream,
    build_answer,
    build_method,
    build_template_answer,
    general_answer,
    proof_from,
    route_from,
)
from app.services.agent.scoring import ScoreResult, score
from app.services.agent.state import AgentState, PlaceInfo, ScriptRun
from earth.blocks import Block, HypothesesBlock
from earth.presets import HOO_HOK_WAI
from knowledge import KnowledgeBase, load_knowledge
from knowledge.schema import LookAlike

POND = ("pond_filling", "water_loss", "seasonal")
RUN_ID = "r_answer1"

#: Filled ponds, persistence checked (pond_filling clearly supported, see test_agent_scoring).
FILLED: dict[str, Any] = {
    "water": {"before": 0.3, "after": -0.2, "delta": -0.5, "local": True, "persistent": True},
    "moisture": {"after": -0.1},
    "bare": {"after": 0.05, "delta": 0.12},
    "greenness": {"after": 0.2},
}
EVIDENCE: list[dict[str, Any]] = [
    {"measure": "water", "value": 0.3, "date": "2024-03-01", "scene": "S2A_A", "clean_px": 900},
    {"measure": "water", "value": -0.2, "date": "2026-09-12", "scene": "S2B_B", "clean_px": 880},
]


@pytest.fixture(scope="module")
def kb() -> KnowledgeBase:
    return load_knowledge()


def _prov(scene: str, day: date, sat: str = "Sentinel-2B", cloud: float = 0.04) -> Any:
    provider = "planetary_s1_rtc" if sat.startswith("Sentinel-1") else "earth_search_s2"
    return earth.Provenance(
        provider=provider,
        satellite=sat,
        scene=scene,
        date=day,
        cloud_over_area=cloud,
        resolution_m=10,
        method="test",
    )


def _step(index: int, prov: Any) -> Step:
    return Step(index=index, title="Read", desc="d", tool="load", provenance=prov)


def _blocks() -> list[Block]:
    return [
        earth.show.stat("Area changed", 4.6, "ha", id="b1"),
        earth.show.hypotheses(
            [
                {
                    "card_id": "pond_filling",
                    "label": "Pond filled in",
                    "expected": {},
                    "observed": {},
                    "verdict": "supported",
                }
            ],
            id="b2",
        ),
        earth.show.limits("Radar was not used.", id="b3"),
    ]


def _record(**kw: Any) -> RunRecord:
    base: dict[str, Any] = {
        "run_id": RUN_ID,
        "thread_id": "t_answer1",
        "user_id": "demo",
        "question": "Have the ponds been filled in?",
        "status": "running",
        "area": HOO_HOK_WAI,
        "blocks": _blocks(),
        "provenance": [_prov("S2A_A", date(2024, 3, 1), "Sentinel-2A")],
        "steps": [
            _step(1, _prov("S2A_A", date(2024, 3, 1), "Sentinel-2A")),  # duplicate of the list
            _step(2, _prov("S2B_B", date(2026, 9, 12))),
            _step(3, _prov("24 scenes", date(2026, 9, 12), "Sentinel-2", cloud=0.0)),
            Step(index=4, title="Find passes", desc="d", tool="scenes"),
        ],
    }
    return RunRecord(**{**base, **kw})


def _state(observed: dict[str, Any] | None = None, **kw: Any) -> AgentState:
    base: dict[str, Any] = {
        "provider": "fake",
        "model": "fake-1",
        "hypotheses": list(POND),
        "cards_read": ["pond_filling", "fish_ponds", "nope"],
        "findings": {"observed": FILLED if observed is None else observed},
        "evidence": EVIDENCE,
        "scripts": [
            ScriptRun(index=1, kind="code", ok=True),
            ScriptRun(index=2, kind="code", ok=True),
            ScriptRun(index=3, kind="code", ok=False),
        ],
        "place": PlaceInfo(name="Hoo Hok Wai ponds", area_ha=38.5),
    }
    return AgentState(**{**base, **kw})


def _finish(**kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "title": "About 4.6 ha of the ponds no longer show open water",
        "sentence": "The water index fell from 0.30 to -0.20 inside the ponds.",
        "cause_card_id": "pond_filling",
        "cause": None,
        "todo": "Check a later image after heavy rain.",
        "stats": [{"label": "Area changed", "value": 4.6}, {"label": "Water index", "value": ""}],
        "caveats": [
            "Radar was not used.",
            "Who did the filling, why, and whether it was permitted cannot be known from "
            "satellite images.",  # also on the card: deduplicated
            "radar was not used",  # duplicate up to case and the full stop
        ],
        "primary_block_id": "b1",
        "followups": ["Since when?", "Since when?", "Is it the same nearby?", "Show passes", "4th"],
        "measure_only": False,
        "unexpected": "ignored",
    }
    return {**base, **kw}


def _roundtrip(answer: Answer) -> Answer:
    """Validate through the stored record, as the API serves it."""
    rec = _record(answer=answer)
    return RunRecord.model_validate_json(rec.model_dump_json()).answer  # type: ignore[return-value]


def _primary(answer: Answer) -> list[str]:
    return [b.id for b in answer.blocks if b.primary]


# --- Place answers ------------------------------------------------------------------------------


def test_build_answer_with_a_supported_cause(kb: KnowledgeBase) -> None:
    state = _state()
    result = score(state, kb)
    assert result.top == "pond_filling"
    answer = build_answer(_finish(), state, result, kb, _record())

    assert answer.kind == "place" and answer.eyebrow == "Hoo Hok Wai ponds"
    assert answer.color == CATEGORY_COLORS["water"] == "#14c6cb"
    assert answer.title.startswith("About 4.6 ha")
    assert answer.sentence.startswith("The water index fell")
    assert (answer.l1, answer.l2) == ("Likely cause", "What to do")
    pond = kb.events["pond_filling"]
    assert pond.wording is not None
    assert answer.cause == pond.wording.use[0]  # no cause text from the model: card wording
    assert answer.todo == "Check a later image after heavy rain."
    assert [(s.l, s.v) for s in answer.stats] == [("Area changed", "4.6")]  # empty value dropped
    assert answer.confidence == result.confidence and answer.confidence.level == "Low"
    assert answer.measure_only is False and answer.preset is False
    assert answer.followups == ["Since when?", "Is it the same nearby?", "Show passes"]

    # caveats: model first, the card's limits always present, deduplicated, at most six
    assert answer.caveats[0] == "Radar was not used."
    assert answer.caveats[1].startswith("Who did the filling")
    assert pond.cannot_tell[1] in answer.caveats
    assert len(answer.caveats) == 6
    assert len({c.casefold().rstrip(".") for c in answer.caveats}) == 6

    # method: registered + read cards (unknown ids skipped), last successful script, model
    m = answer.method
    assert [c.id for c in m.cards] == ["pond_filling", "water_loss", "seasonal", "fish_ponds"]
    assert all(c.version >= 1 and c.status == "draft" for c in m.cards)
    assert m.code_ref == f"run:{RUN_ID}#script2"
    assert m.model == "fake-1" and m.skill is None and answer.skill_id is None
    assert re.fullmatch(r"[0-9a-f]{16}", answer.hash)

    assert _roundtrip(answer) == answer


def test_answer_blocks_hypotheses_and_primary(kb: KnowledgeBase) -> None:
    state = _state()
    result = score(state, kb)
    answer = build_answer(_finish(), state, result, kb, _record())
    assert [b.id for b in answer.blocks] == ["b1", "b2", "b3"]
    assert _primary(answer) == ["b1"]
    hyp = answer.blocks[1]
    assert isinstance(hyp, HypothesesBlock)  # the script's table replaced by code scoring
    assert [r.card_id for r in hyp.rows] == ["pond_filling", "water_loss", "seasonal"]
    assert hyp.rows[0].label == "Pond or wetland filling"

    # the model's primary choice wins, else the first marked one, else the first visual
    answer = build_answer(_finish(primary_block_id="b9"), state, result, kb, _record())
    assert _primary(answer) == ["b1"]
    marked = _blocks()
    marked[2] = marked[2].model_copy(update={"primary": True})
    answer = build_answer(
        _finish(primary_block_id=None), state, result, kb, _record(), blocks=marked
    )
    assert _primary(answer) == ["b3"]
    only_tables = [earth.show.limits("x", id="hypotheses")]
    answer = build_answer(_finish(), state, result, kb, _record(), blocks=only_tables)
    assert [b.id for b in answer.blocks] == ["hypotheses", "hypotheses_2"]
    assert _primary(answer) == ["hypotheses"]
    assert build_answer(_finish(), state, result, kb, _record(), blocks=[]).blocks[0].primary


def test_blocks_to_stream_only_sends_new_or_changed_blocks(kb: KnowledgeBase) -> None:
    state = _state()
    record = _record()
    answer = build_answer(_finish(primary_block_id="b3"), state, score(state, kb), kb, record)
    assert [b.id for b in blocks_to_stream(answer, record)] == ["b2"]  # rescored table only
    no_table = _record(blocks=[b for b in _blocks() if b.id != "b2"])
    answer = build_answer(_finish(), state, score(state, kb), kb, no_table)
    assert [b.id for b in blocks_to_stream(answer, no_table)] == ["hypotheses"]


def test_cause_dropped_when_scoring_does_not_support_it(kb: KnowledgeBase) -> None:
    state = _state()
    result = score(state, kb)
    assert result.verdicts["water_loss"] == "unclear"
    answer = build_answer(
        _finish(cause_card_id="water_loss", cause="drained"), state, result, kb, _record()
    )
    assert answer.cause is None and answer.measure_only is True
    assert answer.color == CATEGORY_COLORS["water"]  # still the top card's colour
    assert answer.confidence.note.startswith("These are measurements only")
    # pond_filling is supported, so the code caveat does not claim that no card fits.
    assert not any(c.startswith("The cause is unknown") for c in answer.caveats)
    assert any(c.startswith("No cause is named") for c in answer.caveats)
    pond = kb.events["pond_filling"]
    assert not set(pond.cannot_tell[1:]) & set(answer.caveats)  # no card named: no card limits


def test_measure_only_finish_names_no_cause(kb: KnowledgeBase) -> None:
    state = _state()
    answer = build_answer(_finish(measure_only=True), state, score(state, kb), kb, _record())
    assert answer.cause is None and answer.measure_only is True
    # Never more certain than code scoring (a draft card: Low), however good the data.
    result = score(state, kb)
    assert answer.confidence.level == result.confidence.level == "Low"
    assert answer.confidence.pct <= result.confidence.pct
    tiny = _state(place=PlaceInfo(name="Tiny pond", area_ha=0.3))
    answer = build_answer(_finish(measure_only=True), tiny, score(tiny, kb), kb, _record())
    assert answer.confidence.level == "Low" and "small" in answer.confidence.note
    assert answer.eyebrow == "Tiny pond"


def test_tie_gives_a_measure_only_answer_with_what_would_settle_it(kb: KnowledgeBase) -> None:
    pond = kb.events["pond_filling"]
    twin = pond.model_copy(
        update={
            "id": "pond_twin",
            "name": "Pond twin",
            "looks_like": [LookAlike(event="pond_filling", tell_apart_by="Visit the site.")],
        }
    )
    twins = replace(kb, events={**kb.events, "pond_twin": twin})
    state = _state(hypotheses=["pond_filling", "pond_twin"])
    result = score(state, twins)
    assert result.cannot_distinguish == ("pond_filling", "pond_twin")
    answer = build_answer(_finish(), state, result, twins, _record())
    assert answer.cause is None and answer.measure_only is True
    tie = [c for c in answer.caveats if c.startswith("Can't tell between")]
    assert tie == [
        "Can't tell between pond or wetland filling and pond twin from this data. "
        "What would settle it: Visit the site."
    ]


def test_color_follows_the_cause_category(kb: KnowledgeBase) -> None:
    obs = {
        "greenness": {"delta": -0.3, "sudden": True, "local": True, "inside_band": False},
        "bare": {"delta": 0.2, "sudden": True, "local": True},
        "slope_deg": 34,
        "rain_mm": 150,
    }
    state = _state(obs, hypotheses=["landslide", "seasonal"])
    result = score(state, kb)
    assert result.top == "landslide"
    finish = _finish(cause_card_id="landslide", cause="consistent with a landslide")
    answer = build_answer(finish, state, result, kb, _record())
    assert answer.color == CATEGORY_COLORS["disasters"] == "#e62b1e"
    assert answer.cause == "consistent with a landslide"
    landslide = kb.events["landslide"]
    assert landslide.cannot_tell[0] in answer.caveats
    nothing = _state({}, hypotheses=["landslide"], evidence=[])
    answer = build_answer(_finish(cause_card_id=None), nothing, score(nothing, kb), kb, _record())
    assert answer.color == DEFAULT_COLOR
    assert answer.confidence.note == "No measurement finished in this run."


def test_finish_args_accepts_models_and_dicts(kb: KnowledgeBase) -> None:
    class Finish(BaseModel):
        title: str
        sentence: str
        cause_card_id: str | None
        measure_only: bool

    state = _state()
    result = score(state, kb)
    model = Finish(title="T", sentence="S.", cause_card_id="pond_filling", measure_only=False)
    a = build_answer(model, state, result, kb, _record())
    b = build_answer(FinishArgs(**model.model_dump()), state, result, kb, _record())
    assert a == b and a.cause is not None
    blank = build_answer({"sentence": "  Only a sentence. "}, state, result, kb, _record())
    assert blank.title == blank.sentence == "Only a sentence."
    assert blank.measure_only is True  # no cause named


def test_no_place_name_falls_back_to_your_area(kb: KnowledgeBase) -> None:
    state = _state(place=None)
    area = earth.Area.from_point(22.3, 114.2, 300)
    answer = build_answer(_finish(), state, score(state, kb), kb, _record(area=area))
    assert answer.eyebrow == "Your area"


# --- Provenance: route, proof, hash -------------------------------------------------------------


def test_route_and_proof_from_provenance(kb: KnowledgeBase) -> None:
    state = _state()
    answer = build_answer(_finish(), state, score(state, kb), kb, _record())
    assert [(p.id, p.date, p.sat, p.cloud, p.used) for p in answer.proof] == [
        ("S2A_A", "2024-03-01", "Sentinel-2A", 4.0, True),
        ("S2B_B", "2026-09-12", "Sentinel-2B", 4.0, True),
    ]  # deduplicated, oldest first, the "24 scenes" series summary left out
    assert [(r.sat, r.status) for r in answer.route] == [
        ("Sentinel-2", "chosen"),
        ("Sentinel-1", "skipped"),
    ]
    radar = [_prov(f"S1A_{i}", date(2026, 9, i + 1), "Sentinel-1A") for i in range(3)]
    route = route_from([_prov("S2A_A", date(2024, 3, 1)), *radar])
    assert [(r.sat, r.status) for r in route] == [
        ("Sentinel-2", "support"),
        ("Sentinel-1", "chosen"),
    ]
    assert route_from([]) == []


def test_proof_keeps_the_oldest_and_newest_scenes() -> None:
    provs = [_prov(f"S2_{i:02d}", date(2026, 1, i + 1)) for i in range(12)]
    proof = proof_from(list(reversed(provs)))
    assert len(proof) == MAX_PROOF
    assert [p.id for p in proof] == ["S2_00", "S2_01", "S2_02", "S2_03"] + [
        "S2_08",
        "S2_09",
        "S2_10",
        "S2_11",
    ]


def test_hash_is_stable_and_tracks_method_and_scenes(kb: KnowledgeBase) -> None:
    state = _state()
    result = score(state, kb)
    a = build_answer(_finish(), state, result, kb, _record())
    b = build_answer(_finish(title="Other words"), state, result, kb, _record())
    assert a.hash == b.hash  # wording does not change the method or scenes
    method = build_method(state, kb, _record(), model="fake-1")
    assert a.hash == answer_hash(method, ["S2B_B", "S2A_A", "S2A_A"])
    assert answer_hash(method, ["S2A_A"]) != a.hash
    other = method.model_copy(update={"code_ref": "run:x#script1"})
    assert answer_hash(other, ["S2A_A", "S2B_B"]) != a.hash


def test_skill_ref_from_skill_runs(kb: KnowledgeBase) -> None:
    scripts = [
        ScriptRun(index=1, kind="skill", skill_id="pond-filling-check", ok=True),
        ScriptRun(index=2, kind="code", ok=False),
        ScriptRun(index=3, kind="skill", skill_id="../etc", ok=False),
    ]
    state = _state(scripts=scripts)
    answer = build_answer(_finish(), state, score(state, kb), kb, _record())
    assert answer.skill_id == "pond-filling-check"
    assert answer.method.skill is not None
    assert answer.method.skill.id == "pond-filling-check" and answer.method.skill.version >= 1
    assert answer.method.code_ref == f"run:{RUN_ID}#script1"
    failed = _state(scripts=[ScriptRun(index=1, kind="skill", skill_id="../etc", ok=False)])
    method = build_method(failed, kb, _record(), model=None)
    assert method.skill is not None and method.skill.version == 1  # unsafe id: never read


# --- Template answers ---------------------------------------------------------------------------

_NUM = re.compile(r"\d+(?:\.\d+)?")


def _numbers_in(obj: Any) -> Iterable[float]:
    """Every number in findings/evidence, including the digits of dates and ids."""
    if isinstance(obj, bool):
        return
    if isinstance(obj, int | float):
        yield float(obj)
    elif isinstance(obj, str):
        yield from (float(m) for m in _NUM.findall(obj))
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _numbers_in(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _numbers_in(v)


def _texts(answer: Answer) -> list[str]:
    return [
        answer.title,
        answer.sentence,
        answer.todo or "",
        answer.confidence.note,
        *answer.caveats,
        *(s.l for s in answer.stats),
        *(s.v for s in answer.stats),
    ]


def _invented(answer: Answer, state: AgentState) -> list[str]:
    """Numbers in the answer text that are not a finding or evidence value (rounding ok)."""
    allowed = [abs(x) for x in _numbers_in([state.findings, state.evidence])]
    bad = []
    for text in _texts(answer):
        for token in _NUM.findall(text):
            decimals = len(token.split(".")[1]) if "." in token else 0
            tol = 0.5 * 10**-decimals + 1e-9
            if not any(abs(float(token) - a) <= tol for a in allowed):
                bad.append(token)
    return bad


@pytest.mark.parametrize("reason", sorted(TEMPLATE_REASONS))
def test_template_answer_only_uses_measured_numbers(kb: KnowledgeBase, reason: str) -> None:
    state = _state(
        {
            **FILLED,
            "rain_mm": {"value": 312.4, "date": "2026-09-08"},
            "junk": {"value": 99},  # not a knowledge measure: left out
        }
    )
    answer = build_template_answer(state, _record(), reason, kb=kb)
    assert _invented(answer, state) == []
    assert answer.cause is None and answer.measure_only is True
    assert answer.confidence.level == "Low"
    assert TEMPLATE_REASONS[reason] in answer.caveats
    assert TEMPLATE_REASONS[reason] in answer.confidence.note
    assert answer.sentence.startswith("Measured so far: water index 0.30 → -0.20 (-0.50)")
    assert [s.l for s in answer.stats] == [
        "Water index",
        "Moisture",
        "Bare ground index",
        "Greenness",
    ]
    assert "99" not in " ".join(_texts(answer))
    assert answer.method.model is None  # templates are code, not the model
    assert answer.method.code_ref == f"run:{RUN_ID}#script2"
    assert answer.proof and answer.route
    assert _roundtrip(answer) == answer


def test_template_answer_from_evidence_only(kb: KnowledgeBase) -> None:
    state = _state({})
    answer = build_template_answer(state, _record(), "time", kb=kb)
    assert answer.sentence == "Measured so far: water index -0.20 on 2026-09-12."
    assert _invented(answer, state) == []


def test_template_answer_with_nothing_measured(kb: KnowledgeBase) -> None:
    state = _state({}, evidence=[], scripts=[])
    answer = build_template_answer(state, _record(blocks=[]), "turns", kb=kb)
    assert answer.stats == [] and answer.blocks == []
    assert not any(ch.isdigit() for t in _texts(answer) for ch in t)
    assert answer.title == "No answer this time"
    assert answer.method.code_ref is None


def test_template_reason_is_never_echoed(kb: KnowledgeBase) -> None:
    state = _state()
    answer = build_template_answer(state, _record(), "the user's PIN is 4821", kb=kb)
    assert "4821" not in answer.model_dump_json()
    assert "The run stopped before it could finish." in answer.caveats


def test_template_answer_can_show_the_scored_table(kb: KnowledgeBase) -> None:
    state = _state()
    result: ScoreResult = score(state, kb)
    answer = build_template_answer(state, _record(), "code_runs", score=result, kb=kb)
    hyp = [b for b in answer.blocks if b.type == "hypotheses"]
    assert len(hyp) == 1 and hyp[0].id == "b2"
    assert answer.cause is None and answer.measure_only is True
    assert len(_primary(answer)) == 1
    default_kb = build_template_answer(state, _record(), "code_runs")  # loads the real cards
    assert [c.id for c in default_kb.method.cards] == [c.id for c in answer.method.cards]


# --- General answers ----------------------------------------------------------------------------


def test_general_answer_for_an_explanation(kb: KnowledgeBase) -> None:
    state = AgentState(provider="fake", model="fake-1", cards_read=["pond_filling", "fish_ponds"])
    finish = {
        "title": "What pond filling looks like from space",
        "sentence": "Water drops and stays gone while the ground turns dry and bright.",
        "caveats": ["Radar alone cannot tell drained from filled."],
        "followups": ["Check my ponds"],
    }
    record = _record(area=None, blocks=[], provenance=[], steps=[])
    answer = general_answer(finish, state, kb, record)
    assert answer.kind == "general" and answer.eyebrow is None
    assert answer.color == CATEGORY_COLORS["water"]
    assert answer.cause is None and answer.measure_only is False
    assert answer.route == [] and answer.proof == [] and answer.blocks == []
    assert answer.confidence.level == "Low" and "no satellite data" in answer.confidence.note
    assert "drafts" in answer.confidence.note
    assert answer.suggested_skills == ["pond-filling-check"]
    assert [c.id for c in answer.method.cards] == ["pond_filling", "fish_ponds"]
    assert answer.method.model == "fake-1" and answer.method.code_ref is None
    assert answer.caveats == ["Radar alone cannot tell drained from filled."]
    assert _roundtrip(answer) == answer


def test_general_answer_confidence_from_card_status(kb: KnowledgeBase) -> None:
    reviewed = replace(
        kb,
        events={
            **kb.events,
            "seasonal": kb.events["seasonal"].model_copy(update={"status": "reviewed"}),
        },
    )
    state = AgentState(provider="fake", model="fake-1", cards_read=["seasonal"])
    record = _record(area=None, blocks=[], provenance=[], steps=[])
    answer = general_answer({"sentence": "Leaves fall."}, state, reviewed, record)
    assert answer.confidence.level == "High"
    assert answer.color == CATEGORY_COLORS["agriculture"]
    none_read = general_answer(
        {"sentence": "Hi."}, AgentState(provider="fake", model="m"), kb, record
    )
    assert none_read.confidence.level == "Low" and none_read.color == DEFAULT_COLOR
    assert none_read.suggested_skills == []
