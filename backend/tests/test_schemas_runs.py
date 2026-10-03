import json
from datetime import date

import pytest
from pydantic import TypeAdapter, ValidationError

import earth
from app.schemas.answer import Answer, Confidence
from app.schemas.areas import AreaInput, AreaResolveRequest, PointInput
from app.schemas.runs import RunRecord, RunRequest, new_run_id, new_thread_id
from app.schemas.stream import (
    AnswerEvent,
    BlockReady,
    ClarificationNeeded,
    ClarificationQuestion,
    Done,
    ErrorEvent,
    ExpectationRow,
    GuardEvent,
    HypothesesRegistered,
    RunStarted,
    StepFinished,
    StepStarted,
    StreamEvent,
    ValueSource,
    to_sse,
)
from app.services.sandbox import RUN_ID_RE
from earth.render import validate_run_id

EVENTS = TypeAdapter(StreamEvent)
POLY = {
    "type": "Polygon",
    "coordinates": [
        [[114.0, 22.49], [114.01, 22.49], [114.01, 22.5], [114.0, 22.5], [114.0, 22.49]]
    ],
}


def test_area_input_exactly_one() -> None:
    with pytest.raises(ValidationError):
        AreaInput()
    with pytest.raises(ValidationError):
        AreaInput(geojson=POLY, point=PointInput(lat=22.49, lon=114.03))
    a = AreaInput(point=PointInput(lat=22.49, lon=114.03, radius_m=350), name="HHW").to_area()
    assert a.name == "HHW" and a.area_ha > 0
    assert AreaInput(geojson=POLY).to_area().area_ha > 0
    with pytest.raises(ValidationError):
        PointInput(lat=91, lon=0)
    with pytest.raises(ValidationError):
        AreaResolveRequest(query="x", link="y")
    AreaResolveRequest(query="Hoo Hok Wai")


def test_run_request_validation() -> None:
    r = RunRequest(question="  is it drying?  ", place_id="hoo_hok-wai")
    assert r.question == "is it drying?"
    for bad in ("", "   ", "x" * 2001):
        with pytest.raises(ValidationError):
            RunRequest(question=bad)
    with pytest.raises(ValidationError):
        RunRequest(question="q", place_id="../etc")
    with pytest.raises(ValidationError):
        RunRequest(question="q", thread_id="T_UPPER")


def _answer() -> Answer:
    return Answer(
        title="The ponds were filled in",
        sentence="Ponds filled.",
        confidence=Confidence(level="Medium", pct=70, note="ok"),
        blocks=[earth.show.stat("Water", 1.2, "ha")],
        hash="abc",
    )


def all_events() -> list:
    prov = earth.Provenance(
        provider="stub",
        satellite="Sentinel-2B",
        scene="S2B_X",
        date=date(2026, 9, 30),
        cloud_over_area=0.1,
        resolution_m=10,
        method="NDVI",
    )
    return [
        RunStarted(run_id="r_0123456789ab", thread_id="t_0123456789ab"),
        GuardEvent(scope="answerable"),
        HypothesesRegistered(
            hypotheses=["pond_filling"],
            expectation_table=[ExpectationRow(hypothesis="pond_filling", expected={"water": "up"})],
        ),
        ClarificationNeeded(
            questions=[
                ClarificationQuestion(
                    key="crop",
                    label="What crop?",
                    options=["Maize"],
                    value="Maize",
                    source=ValueSource(from_="memory", saved=date(2026, 9, 1)),
                )
            ]
        ),
        StepStarted(index=0, title="Look", desc="d", tool="describe"),
        StepFinished(index=0, title="Look", desc="d", tool="describe", ms=5, provenance=prov),
        BlockReady(block=earth.show.limits("Can't see under clouds")),
        AnswerEvent(answer=_answer()),
        ErrorEvent(message="boom", recoverable=True, kind="no_clear_scenes"),
        Done(run_id="r_0123456789ab", status="done", ms=1200),
    ]


def test_stream_event_round_trip() -> None:
    evs = all_events()
    assert len({e.event for e in evs}) == 10
    for ev in evs:
        back = EVENTS.validate_json(ev.model_dump_json(by_alias=True))
        assert type(back) is type(ev) and back == ev
        sse = to_sse(ev)
        assert sse["event"] == ev.event and json.loads(sse["data"])["event"] == ev.event


def test_value_source_alias() -> None:
    vs = ValueSource(from_="inferred")
    assert json.loads(vs.model_dump_json())["from"] == "inferred"
    assert ValueSource.model_validate({"from": "memory"}).from_ == "memory"
    data = json.loads(to_sse(all_events()[3])["data"])
    assert data["questions"][0]["source"]["from"] == "memory"


def test_ids_and_record() -> None:
    for _ in range(20):
        rid, tid = new_run_id(), new_thread_id()
        assert RUN_ID_RE.fullmatch(rid) and RUN_ID_RE.fullmatch(tid)
        assert validate_run_id(rid) == rid
        assert len(rid) == 14 and rid.startswith("r_") and tid.startswith("t_")
    rec = RunRecord(
        run_id=new_run_id(),
        thread_id=new_thread_id(),
        user_id="demo",
        question="q",
        status="done",
        answer=_answer(),
        events=all_events(),
    )
    back = RunRecord.model_validate_json(rec.model_dump_json())
    assert back == rec and back.created_at.tzinfo is not None
