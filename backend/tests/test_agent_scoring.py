"""A3 scoring (HANDOFF B3.3-B3.4): sign checks, verdicts, ties, confidence caps and the
hypotheses block, on the real knowledge cards with synthetic findings. Offline, no LLM."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest

from app.services.agent.scoring import (
    Reading,
    ScoreResult,
    check_sign,
    data_quality,
    expected_rows,
    expected_text,
    fmt_num,
    hypotheses_block,
    observed_readings,
    observed_text,
    score,
)
from app.services.agent.state import AgentState, PlaceInfo, ScriptRun
from earth.blocks import validate_block
from knowledge import EventCard, KnowledgeBase, load_knowledge
from knowledge.schema import Confidence as CardConfidence
from knowledge.schema import LookAlike, Sign

POND = ("pond_filling", "water_loss", "seasonal")
SLIDE = ("landslide", "seasonal", "vegetation_loss")


@pytest.fixture(scope="module")
def kb() -> KnowledgeBase:
    return load_knowledge()


def _kb_with(kb: KnowledgeBase, card_id: str, **update: Any) -> KnowledgeBase:
    """A copy of `kb` with one event card changed (e.g. status or thresholds)."""
    events = dict(kb.events)
    events[card_id] = kb.events[card_id].model_copy(update=update)
    return replace(kb, events=events)


def _state(
    observed: dict[str, Any] | None,
    hypotheses: tuple[str, ...] = POND,
    *,
    ran: bool = True,
    **kw: Any,
) -> AgentState:
    scripts = [ScriptRun(index=1, kind="code", ok=True)] if ran else []
    findings = {"observed": observed} if observed is not None else {}
    return AgentState(
        provider="fake",
        model="fake-1",
        hypotheses=list(hypotheses),
        findings=findings,
        scripts=scripts,
        **kw,
    )


#: Ponds that lost their water and are dry, bare ground now (no persistence check yet).
FILLISH: dict[str, Any] = {
    "water": {"before": 0.3, "after": -0.2, "delta": -0.5, "local": True},
    "moisture": {"after": -0.1},
    "bare": {"after": 0.05, "delta": 0.12},
    "greenness": {"after": 0.2},
}


def _fill(**water: Any) -> dict[str, Any]:
    obs = {k: dict(v) for k, v in FILLISH.items()}
    obs["water"].update(water)
    return obs


def _sign(**kw: Any) -> Sign:
    base: dict[str, Any] = {"measure": "water", "change": "down", "weight": 2}
    return Sign(**{**base, **kw})


# --- Sign checks --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("sign", "reading", "state"),
    [
        # direction with by_more_than: pass / partial zone (unknown) / miss / opposite
        (dict(change="down", by_more_than=0.2), dict(delta=-0.3), "pass"),
        (dict(change="down", by_more_than=0.2), dict(delta=-0.1), "unknown"),
        (dict(change="down", by_more_than=0.2), dict(delta=-0.04), "fail"),
        (dict(change="down", by_more_than=0.2), dict(delta=0.3), "fail"),
        (dict(change="up", by_more_than=0.1), dict(before=0.1, after=0.3), "pass"),
        (dict(change="up"), dict(delta=0.2), "pass"),  # no by: beyond noise
        (dict(change="up"), dict(delta=-0.2), "fail"),
        (dict(change="down"), dict(value=0.2), "unknown"),  # no change measured
        # stable
        (dict(change="stable"), dict(delta=0.02), "pass"),
        (dict(change="stable"), dict(delta=0.3), "fail"),
        (dict(change="stable", by_more_than=0.1), dict(delta=0.15), "unknown"),
        # thresholds (after, else value) with a noise margin
        (dict(change="below", threshold=-0.05, measure="moisture"), dict(after=-0.1), "pass"),
        (dict(change="below", threshold=-0.05, measure="moisture"), dict(after=-0.02), "unknown"),
        (dict(change="below", threshold=-0.05, measure="moisture"), dict(after=0.1), "fail"),
        (dict(change="above", threshold=20, measure="slope_deg"), dict(value=34), "pass"),
        (dict(change="above", threshold=20, measure="slope_deg"), dict(value=12), "fail"),
        (dict(change="above", threshold=100, measure="rain_mm"), dict(value=95), "unknown"),
        # normal range
        (dict(change="inside_band"), dict(inside_band=True), "pass"),
        (dict(change="inside_band"), dict(inside_band=False), "fail"),
        (dict(change="inside_band"), dict(delta=0.3), "unknown"),
        (dict(change="outside_band"), dict(inside_band=False), "pass"),
        (dict(change="outside_band", by_more_than=3), dict(delta=-4.0), "pass"),
        (dict(change="outside_band", by_more_than=3), dict(delta=0.5), "fail"),
    ],
)
def test_check_sign_values(sign: dict, reading: dict, state: str) -> None:
    got, why = check_sign(_sign(**sign), Reading(**reading))
    assert got == state, why
    assert not any(ch.isdigit() for ch in why)  # reasons carry no numbers


def test_check_sign_unmeasured_is_unknown() -> None:
    assert check_sign(_sign(), None) == ("unknown", "not measured")


def test_check_sign_timing_and_spatial() -> None:
    sudden_local = _sign(by_more_than=0.15, timing="sudden", spatial="local")
    assert check_sign(sudden_local, Reading(delta=-0.3, sudden=True, local=True))[0] == "pass"
    assert check_sign(sudden_local, Reading(delta=-0.3, sudden=False)) == (
        "fail",
        "the change was gradual",
    )
    assert check_sign(sudden_local, Reading(delta=-0.3, local=False))[0] == "fail"
    gradual = _sign(timing="gradual")
    assert check_sign(gradual, Reading(delta=-0.3, sudden=True))[0] == "fail"
    regional = _sign(change="inside_band", spatial="regional")
    assert check_sign(regional, Reading(inside_band=True, local=True)) == (
        "fail",
        "only this area changed",
    )
    # unknown timing / spatial does not change the value check
    assert check_sign(sudden_local, Reading(delta=-0.3))[0] == "pass"


def test_check_sign_persistence(kb: KnowledgeBase) -> None:
    lasting = kb.events["pond_filling"].signs[1]  # water below 0, shape "stays below 0 ..."
    assert "lasting" in expected_text(lasting)
    assert check_sign(lasting, Reading(after=-0.2, persistent=True))[0] == "pass"
    assert check_sign(lasting, Reading(after=-0.2, persistent=False)) == ("fail", "did not last")
    state, why = check_sign(lasting, Reading(after=-0.2))
    assert state == "unknown" and "later images" in why  # not checked yet: no full credit
    assert check_sign(lasting, Reading(persistent=True))[0] == "pass"  # only persistence known
    stays = kb.events["new_bare_or_built"].signs[1]  # bare stable, "stays raised ..."
    assert stays.change == "stable"
    assert check_sign(stays, Reading(delta=0.3, persistent=True))[0] == "pass"
    assert check_sign(stays, Reading(delta=0.0))[0] == "unknown"


def test_expected_text() -> None:
    assert expected_text(_sign(by_more_than=0.15, timing="sudden", spatial="local")) == (
        "↓ by > 0.15, sudden, local"
    )
    assert expected_text(_sign(change="below", threshold=0, optional=True)) == "< 0, optional"
    assert expected_text(_sign(change="inside_band", timing="seasonal")) == "inside normal range"


def test_readings_tolerate_junk() -> None:
    obs = {
        "water": {"before": "0.3", "after": float("nan"), "delta": -0.2, "local": 1},
        "slope_deg": 34,
        "rain_mm": True,
        "bare": "high",
        "moisture": {},
        "greenness": {"after": 0.2, "date": "2026-09-12T10:00:00"},
    }
    r = observed_readings({"observed": obs})
    assert set(r) == {"water", "slope_deg", "greenness"}
    assert r["water"] == Reading(delta=-0.2)  # strings, NaN and ints-as-bools dropped
    assert r["slope_deg"].level == 34
    assert r["greenness"].date == "2026-09-12"
    assert observed_readings({}) == {} and observed_readings({"observed": [1, 2]}) == {}


def test_observed_text_and_numbers() -> None:
    r = Reading(before=0.41, after=0.12, delta=-0.29, inside_band=False, local=True)
    assert observed_text(r) == "0.41 → 0.12 (-0.29), outside normal range, local"
    assert observed_text(Reading(value=312.4, date="2026-09-08")) == "312, on 2026-09-08"
    assert observed_text(Reading(sudden=True)) == "sudden"
    assert fmt_num(-0.001) == "0.00" and fmt_num(12.34) == "12.3" and fmt_num(0.4) == "0.40"


# --- Verdicts -----------------------------------------------------------------------------------


def test_pond_filling_supported_and_ranked_first(kb: KnowledgeBase) -> None:
    result = score(_state(_fill(persistent=True)), kb)
    assert result.top == "pond_filling"
    assert result.verdicts == {
        "pond_filling": "supported",
        "water_loss": "unclear",  # look-alike, clearly beaten by pond_filling
        "seasonal": "contradicted",  # a local change, not regional
    }
    assert [c.card_id for c in result.cards] == ["pond_filling", "water_loss", "seasonal"]
    pond = result.card("pond_filling")
    assert pond is not None
    # 3 + 3 + 0.4*2 (radar unknown) + 2 + 1 + 1 of 12
    assert pond.weight == pytest.approx(10.8) and pond.possible == 12
    assert result.scores["pond_filling"] == pytest.approx(0.9)
    assert "fits the data better" in result.card("water_loss").reason  # type: ignore[union-attr]
    assert result.cannot_distinguish is None
    assert result.cause_problem("pond_filling") is None
    assert "fits the data better" in (result.cause_problem("water_loss") or "")
    assert "not registered" in (result.cause_problem("landslide") or "")
    # rows: expected from card signs, observed from the readings
    row = result.rows[0]
    assert row.hypothesis == "pond_filling" and row.verdict == "supported"
    assert row.expected["water"] == "↓ by > 0.2, local; < 0, local, lasting"
    assert row.observed["water"] == "0.30 → -0.20 (-0.50), local, lasting"
    assert "roughness" in row.expected and "roughness" not in row.observed


def test_contradicted_when_the_anchor_sign_fails(kb: KnowledgeBase) -> None:
    obs = {"water": {"before": 0.1, "after": 0.35, "delta": 0.25, "local": True}}
    result = score(_state(obs), kb)
    assert result.verdicts["pond_filling"] == "contradicted"
    assert result.verdicts["water_loss"] == "contradicted"
    assert result.top is None
    assert "Does not match: water" in result.card("pond_filling").reason  # type: ignore[union-attr]
    assert result.confidence.level == "Low"
    assert "No cause fits" in result.confidence.note


def test_refilled_pond_is_not_filling(kb: KnowledgeBase) -> None:
    result = score(_state(_fill(persistent=False)), kb)
    assert result.verdicts["pond_filling"] == "contradicted"  # it came back: drain-down
    reason = result.card("pond_filling").reason  # type: ignore[union-attr]
    assert reason == "Does not match: water < 0, local, lasting (did not last)."
    assert "did not last" in (result.cause_problem("pond_filling") or "")


def test_still_holding_water_contradicts_filling(kb: KnowledgeBase) -> None:
    obs = {"water": {"before": 0.3, "after": 0.2, "delta": -0.1, "local": True}}
    result = score(_state(obs), kb)
    assert result.verdicts["pond_filling"] == "contradicted"  # anchor "below 0" fails
    assert result.top is None


def test_unclear_with_partial_evidence(kb: KnowledgeBase) -> None:
    obs = {
        "water": {"before": 0.13, "after": 0.03, "delta": -0.1, "local": True},  # near the lines
        "greenness": {"after": 0.2, "local": True},
    }
    result = score(_state(obs), kb)
    pond = result.card("pond_filling")
    assert pond is not None and pond.verdict == "unclear"
    assert pond.weight == pytest.approx(1.2 + 1.2 + 0.8 + 0.8 + 0.4 + 1)
    assert "Matches: greenness" in pond.reason and "Not checked" in pond.reason
    assert result.top is None


def test_untested_without_data(kb: KnowledgeBase) -> None:
    result = score(_state(None, ran=False), kb)
    assert set(result.verdicts.values()) == {"untested"}
    assert result.top is None and not result.data_read
    assert result.confidence.level == "Low"
    assert "No satellite data" in result.confidence.note
    assert all(r.observed == {} for r in result.rows)
    # data was read but nothing landed in findings["observed"]
    empty = score(_state({}), kb)
    assert set(empty.verdicts.values()) == {"untested"}
    assert "No cause fits" in empty.confidence.note


def test_near_tie_settled_by_discriminating_measures(kb: KnowledgeBase) -> None:
    """Fill vs drained pond, persistence unknown: close on overall score, but the cards'
    discriminating measures (dry moisture, bare ground) favour filling."""
    result = score(_state(_fill()), kb)
    assert result.scores["pond_filling"] == pytest.approx(0.75)
    assert result.scores["water_loss"] == pytest.approx(5.2 / 7, abs=1e-3)  # within 15%
    assert result.cannot_distinguish is None
    assert result.top == "pond_filling"
    water_loss = result.card("water_loss")
    assert water_loss is not None and water_loss.verdict == "unclear"
    assert "fits better on what tells them apart" in water_loss.reason
    assert "moisture" in water_loss.reason


def _with_twin(kb: KnowledgeBase, measures: list[str]) -> KnowledgeBase:
    """`kb` plus `pond_twin`: pond_filling's signs under another id, a look-alike of it."""
    pond = kb.events["pond_filling"]
    twin = pond.model_copy(
        update={
            "id": "pond_twin",
            "name": "Pond twin",
            "looks_like": [
                LookAlike(
                    event="pond_filling",
                    tell_apart_by="Only a site visit tells them apart.",
                    discriminating_measures=measures,
                )
            ],
        }
    )
    return replace(kb, events={**kb.events, "pond_twin": twin})


def test_cannot_distinguish_top_two_within_15_percent(kb: KnowledgeBase) -> None:
    twins = _with_twin(kb, [])
    result = score(_state(_fill(persistent=True), ("pond_filling", "pond_twin", "seasonal")), twins)
    assert result.verdicts["pond_filling"] == result.verdicts["pond_twin"] == "supported"
    assert result.cannot_distinguish == ("pond_filling", "pond_twin")
    assert result.top is None
    assert result.settle == "Only a site visit tells them apart."
    assert result.confidence.level == "Low" and "Can't tell between" in result.confidence.note
    assert "Can't tell between" in (result.cause_problem("pond_filling") or "")
    block = hypotheses_block(result)
    assert block.caption and "Can't tell between" in block.caption
    # same evidence on the discriminating measures: still a tie
    same = score(
        _state(_fill(persistent=True), ("pond_filling", "pond_twin")), _with_twin(kb, ["water"])
    )
    assert same.cannot_distinguish == ("pond_filling", "pond_twin")


def test_landslide_supported_and_timing_matters(kb: KnowledgeBase) -> None:
    obs = {
        "greenness": {"delta": -0.3, "sudden": True, "local": True, "inside_band": False},
        "bare": {"delta": 0.2, "sudden": True, "local": True},
        "moisture": {"delta": -0.15, "sudden": True, "local": True},
        "slope_deg": {"value": 34},
        "rain_mm": {"value": 150},
    }
    result = score(_state(obs, SLIDE), kb)
    assert result.top == "landslide"
    assert result.verdicts["seasonal"] == "contradicted"  # greenness left the normal band
    slide = result.card("landslide")
    assert slide is not None and slide.weight == 8 and slide.possible == 8  # optional radar out
    gradual = {k: {**v, "sudden": False} if "sudden" in v else v for k, v in obs.items()}
    result = score(_state(gradual, SLIDE), kb)
    assert result.verdicts["landslide"] == "contradicted"
    assert result.top != "landslide"


def test_place_slope_from_describe_is_scored(kb: KnowledgeBase) -> None:
    """Live regression: on flat fish ponds (describe: slope mean 1.2) no script measured slope,
    so landslide's "slope above 20" stayed unknown and landslide came out supported. The
    describe slope (`context_observed`) is now checked; a script's own reading still wins."""
    obs = {
        "greenness": {"delta": -0.3, "sudden": True, "local": True, "inside_band": False},
        "bare": {"delta": 0.2, "sudden": True, "local": True},
        "moisture": {"delta": -0.15, "sudden": True, "local": True},
    }
    flat = {"slope_deg": {"value": 1.2}}
    unseeded = score(_state(obs, SLIDE), kb).card("landslide")
    seeded = score(_state(obs, SLIDE, context_observed=flat), kb).card("landslide")
    assert unseeded is not None and seeded is not None
    assert [c.state for c in unseeded.signs if c.measure == "slope_deg"] == ["unknown"]
    assert [c.state for c in seeded.signs if c.measure == "slope_deg"] == ["fail"]
    assert seeded.weight < unseeded.weight
    assert "1.20" in seeded.observed["slope_deg"]

    steep = score(_state({**obs, "slope_deg": {"value": 34}}, SLIDE, context_observed=flat), kb)
    slide = steep.card("landslide")
    assert slide is not None
    assert [c.state for c in slide.signs if c.measure == "slope_deg"] == ["pass"]
    # Context alone is not data: nothing is scored before a script ran.
    none = score(_state(None, SLIDE, ran=False, context_observed=flat), kb)
    assert all(v == "untested" for v in none.verdicts.values())


def test_context_signs_alone_never_support(kb: KnowledgeBase) -> None:
    easy = _kb_with(
        kb, "landslide", confidence=CardConfidence(high_min_weight=4, medium_min_weight=2)
    )
    obs = {"slope_deg": {"value": 34}, "rain_mm": {"value": 150}}
    result = score(_state(obs, ("landslide",)), easy)
    slide = result.card("landslide")
    assert slide is not None and slide.weight >= 2  # over the threshold on context alone
    assert slide.verdict == "unclear" and "Only context signs" in slide.reason
    assert result.top is None


def test_seasonal_supported_when_change_is_regional_and_normal(kb: KnowledgeBase) -> None:
    obs = {
        "greenness": {"delta": -0.1, "inside_band": True, "local": False},
        "moisture": {"delta": -0.06, "inside_band": True, "local": False},
        "water": {"delta": -0.06, "after": 0.2, "inside_band": True, "local": False},
        "bare": {"delta": 0.04, "inside_band": True, "local": False},
    }
    result = score(_state(obs), kb)
    assert result.top == "seasonal"
    assert result.verdicts["pond_filling"] == "contradicted"  # local signs, regional change
    assert not result.no_change


def test_no_notable_change_is_not_seasonal(kb: KnowledgeBase) -> None:
    obs = {
        m: {"delta": d, "inside_band": True, "local": False}
        for m, d in (("greenness", 0.02), ("moisture", -0.01), ("water", 0.03), ("bare", 0.0))
    }
    result = score(_state(obs), kb)
    assert result.no_change
    seasonal = result.card("seasonal")
    assert seasonal is not None and seasonal.weight >= 5  # would pass on weight alone
    assert seasonal.verdict == "unclear" and "no notable change" in seasonal.reason
    assert result.top is None


def test_unknown_and_setting_ids_are_skipped(kb: KnowledgeBase) -> None:
    result = score(_state(_fill(), ("pond_filling", "fish_ponds", "nope")), kb)
    assert [c.card_id for c in result.cards] == ["pond_filling"]


# --- Confidence ---------------------------------------------------------------------------------

#: Every pond_filling sign matches, radar included: weight 12 >= high_min_weight 11.
FULL_FILL = {**_fill(persistent=True), "roughness": {"delta": 8.0, "local": True}}


@pytest.mark.parametrize(
    ("status", "level"), [("draft", "Low"), ("tested", "Medium"), ("reviewed", "High")]
)
def test_confidence_capped_by_card_status(kb: KnowledgeBase, status: str, level: str) -> None:
    result = score(_state(FULL_FILL), _kb_with(kb, "pond_filling", status=status))
    assert result.top == "pond_filling"
    assert result.confidence.level == level
    lo, hi = {"High": (80, 95), "Medium": (55, 79), "Low": (20, 50)}[level]
    assert lo <= result.confidence.pct <= hi
    assert ("draft" in result.confidence.note) == (status == "draft")
    assert not any(ch.isdigit() for ch in result.confidence.note)


def test_confidence_medium_from_thresholds(kb: KnowledgeBase) -> None:
    reviewed = _kb_with(kb, "pond_filling", status="reviewed")
    result = score(_state(_fill(persistent=True)), reviewed)  # weight 10.8: medium, not high
    assert result.confidence.level == "Medium"
    assert result.confidence.note.startswith("Most signs of pond or wetland filling")


def test_post_hoc_hypothesis_capped_low(kb: KnowledgeBase) -> None:
    reviewed = _kb_with(kb, "pond_filling", status="reviewed")
    result = score(_state(FULL_FILL, post_hoc=["pond_filling"]), reviewed)
    assert result.top == "pond_filling"
    assert result.confidence.level == "Low"
    assert "after the data was seen" in result.confidence.note
    block = hypotheses_block(result)
    assert block.post_hoc is True
    assert block.rows[0].reason and block.rows[0].reason.startswith("Added after the data")


@pytest.mark.parametrize(
    ("evidence", "place", "phrase"),
    [
        (
            [
                {"measure": "water", "value": 0.3, "scene": "S2A_1", "clean_px": 30},
                {"measure": "water", "value": 0.1, "scene": "S2B_2", "clean_px": 800},
            ],
            None,
            "pixels",
        ),
        ([{"measure": "water", "value": 0.1, "provenance": {"scene": "S2A_1"}}], None, "one"),
        ([], PlaceInfo(name="Tiny pond", area_ha=0.4), "small"),
    ],
)
def test_poor_data_downgrades_confidence(
    kb: KnowledgeBase, evidence: list, place: PlaceInfo | None, phrase: str
) -> None:
    reviewed = _kb_with(kb, "pond_filling", status="reviewed")
    state = _state(FULL_FILL, evidence=evidence, place=place)
    assert len(data_quality(state)) == 1 and phrase in data_quality(state)[0]
    result = score(state, reviewed)
    assert result.confidence.level == "Medium"  # High, one step down
    assert phrase in result.confidence.note
    assert not any(ch.isdigit() for ch in result.confidence.note)


def test_good_data_has_no_quality_issues() -> None:
    evidence = [
        {"measure": "water", "value": 0.3, "scene": "S2A_1", "clean_px": 900},
        {"measure": "water", "value": -0.2, "scene": "S2B_2", "clean_px": 870},
        {"measure": "water (series)", "value": -0.2, "scene": "24 scenes"},
    ]
    state = _state(FULL_FILL, evidence=evidence, place=PlaceInfo(area_ha=38.0))
    assert data_quality(state) == []


# --- Blocks and rows ----------------------------------------------------------------------------


def test_hypotheses_block_is_a_valid_block(kb: KnowledgeBase) -> None:
    result = score(_state(_fill(persistent=True)), kb)
    block = hypotheses_block(result, id="b9")
    assert block.type == "hypotheses" and block.id == "b9" and block.post_hoc is False
    assert [r.card_id for r in block.rows] == ["pond_filling", "water_loss", "seasonal"]
    assert block.rows[0].label == "Pond or wetland filling"
    assert block.rows[0].score == pytest.approx(0.9)
    assert validate_block(block.model_dump(mode="json")) == block
    untested = hypotheses_block(score(_state(None, ran=False), kb))
    assert all(r.score is None and r.verdict == "untested" for r in untested.rows)


def test_expected_rows_before_data(kb: KnowledgeBase) -> None:
    rows = expected_rows(kb, ["pond_filling", "seasonal", "pond_filling", "fish_ponds"])
    assert [r.hypothesis for r in rows] == ["pond_filling", "seasonal"]
    assert all(r.verdict == "untested" and r.observed == {} for r in rows)
    assert rows[1].expected["greenness"] == "inside normal range, regional"


def test_score_result_round_trips_as_json(kb: KnowledgeBase) -> None:
    hyps = ("pond_filling", "pond_twin")
    result = score(_state(_fill(persistent=True), hyps), _with_twin(kb, []))
    again = ScoreResult.model_validate_json(result.model_dump_json())
    assert again == result
    assert again.cannot_distinguish == ("pond_filling", "pond_twin")


def test_every_card_scores_without_error(kb: KnowledgeBase) -> None:
    """Each real event card scores on a broad synthetic reading set (no crashes, sane bounds)."""
    obs = {
        "greenness": {"before": 0.6, "after": 0.3, "delta": -0.3, "inside_band": False},
        "moisture": {"delta": -0.2, "after": -0.1},
        "water": {"before": 0.2, "after": -0.1, "delta": -0.3, "persistent": True},
        "bare": {"delta": 0.2, "after": 0.1},
        "roughness": {"delta": 4.0, "after": -9.0},
        "slope_deg": 25,
        "rain_mm": {"value": 120},
    }
    result = score(_state(obs, tuple(kb.events)), kb)
    assert {c.card_id for c in result.cards} == set(kb.events)
    for card in result.cards:
        assert -1 <= card.score <= 1
        event: EventCard = kb.events[card.card_id]
        assert len(card.signs) == len(event.signs)
