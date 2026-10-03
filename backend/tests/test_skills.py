"""Skills registry (BUILD-PLAN A3/S1): SKILL.md parsing and validation, params vs run.py,
param checks before a run, the FINDINGS CONVENTION adapter, tests.yaml, and a stub sandbox run.
Offline: EARTH_IMPL=stub, no LLM."""

from __future__ import annotations

import asyncio
import importlib.util
import inspect
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml

import earth
from app.services.agent import skills as sk
from app.services.agent.skills import (
    OBSERVED_KEYS,
    Skill,
    SkillError,
    SkillNotFound,
    SkillParamError,
    adapt_findings,
    check_skill,
    get_skill,
    get_skill_script,
    prepare_params,
    run_skill_script,
    script_params,
    skill_ids,
    skills_index_text,
)
from app.services.sandbox import RunOutcome, scan_script
from earth.blocks import validate_block
from earth.presets import HOO_HOK_WAI
from knowledge import ALL_MEASURES, KnowledgeBase, load_knowledge

POND = "pond-filling-check"
POND_DIR = Path(__file__).resolve().parents[1] / "skills" / POND
TESTS_YAML = yaml.safe_load((POND_DIR / "tests.yaml").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def kb() -> KnowledgeBase:
    return load_knowledge()


@pytest.fixture(scope="module")
def pond() -> Skill:
    sk.clear_cache()
    return get_skill(POND)


@pytest.fixture(scope="module")
def stub_env(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    """Stub earth and a throwaway data dir for every sandbox child of this module."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("EARTH_IMPL", "stub")
        mp.setenv("EARTH_DATA_DIR", str(tmp_path_factory.mktemp("earth_data")))
        yield


def _run(skill: Skill, params: dict[str, Any], area: dict | None, name: str | None) -> RunOutcome:
    prepared = prepare_params(skill, params, area=area, name=name)
    return asyncio.run(run_skill_script(skill.id, prepared, "r_skilltest"))


@pytest.fixture(scope="module")
def preset_outcome(stub_env: None, pond: Skill) -> RunOutcome:
    return _run(pond, {}, HOO_HOK_WAI.geojson, HOO_HOK_WAI.name)


# --- SKILL.md -----------------------------------------------------------------------------------


def test_pond_skill_is_listed_and_parsed(pond: Skill) -> None:
    assert POND in skill_ids()
    assert pond.id == POND
    assert pond.version == 1
    assert pond.status == "draft"
    assert pond.tests_events == ["pond_filling"]
    assert pond.considers == ["seasonal", "water_loss", "construction", "new_bare_or_built"]
    assert {"then_now", "timeline", "hypotheses", "limits"} <= set(pond.outputs)
    assert pond.script == (POND_DIR / "run.py").read_text(encoding="utf-8")
    assert get_skill_script(POND) == pond.script
    assert set(pond.model_params) == {"years", "before", "after", "answers"}
    assert pond.params["area"].auto and pond.params["area"].required
    assert pond.params["name"].auto and not pond.params["name"].required


def test_skill_md_validates(pond: Skill, kb: KnowledgeBase) -> None:
    assert check_skill(pond, kb) == []


def test_params_match_run_py_signature(pond: Skill) -> None:
    """run.py takes `run(**params)`, so inspect gives only the catch-all; the keys it reads
    (`params.get(...)`, `params[...]`) must be exactly the declared params, same defaults."""
    sig = inspect.signature(_load_run(POND_DIR / "run.py"))
    kinds = [p.kind for p in sig.parameters.values()]
    assert kinds == [inspect.Parameter.VAR_KEYWORD]
    found = script_params(pond.script)
    assert set(found) == set(pond.params)
    for key, p in pond.params.items():
        if not p.required:
            assert found[key] == p.default, key
    assert found["years"] == 4


def _load_run(path: Path):
    """run.py's `run`, imported as a module (it only defines functions and constants)."""
    spec = importlib.util.spec_from_file_location("pond_filling_run", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.run


def test_limits_copied_from_the_card(pond: Skill, kb: KnowledgeBase) -> None:
    body = " ".join(pond.body.split())
    for item in kb.events["pond_filling"].cannot_tell:
        assert " ".join(item.split()) in body


def test_run_py_passes_the_sandbox_scan(pond: Skill) -> None:
    assert scan_script(pond.script) is None


def test_skills_index_text_is_compact_and_stable(pond: Skill) -> None:
    text = skills_index_text([pond])
    assert text == skills_index_text()  # one skill on disk today
    assert text.startswith(f"- {POND} (Pond filling check) [draft v1]: ")
    assert "years (int, default 4, 3..5)" in text
    assert "before (date YYYY-MM-DD, default null)" in text
    assert "set by the harness: area, name (needs an outline)" in text
    params_lines = text.split("params_json keys:")[1].split("set by the harness")[0]
    assert "area (" not in params_lines and "name (" not in params_lines
    assert skills_index_text([]) == "(no skills yet)"


# --- Lookup -------------------------------------------------------------------------------------


@pytest.mark.parametrize("bad", ["", "../knowledge", "Pond-Filling", "a/b", "x" * 80, None, 3])
def test_get_skill_rejects_malformed_ids(bad: Any) -> None:
    with pytest.raises(SkillNotFound):
        get_skill(bad)


def test_get_skill_unknown_id() -> None:
    with pytest.raises(SkillNotFound):
        get_skill("slope-check-that-does-not-exist")


def _write_skill(root: Path, sid: str, header: str, body: str, script: str) -> None:
    d = root / sid
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(f"---\n{header}\n---\n{body}", encoding="utf-8")
    (d / "run.py").write_text(script, encoding="utf-8")


_GOOD_BODY = "\n## What it does\nx\n\n## When to use it\ny\n\n## Limits\nz\n"
_GOOD_HEADER = """id: demo
version: 1
status: draft
name: Demo
summary: A demo skill.
tests_events: [landslide]
params:
  area: {type: area, auto: true, required: true}
  days: {type: int, default: 60, min: 14, max: 365}
outputs: [timeline]"""
_GOOD_SCRIPT = """import earth


def run(**params):
    area = earth.Area.from_geojson(params["area"])
    days = params.get("days", 60)
    return {"findings": {"observed": {}}, "evidence": [], "blocks": [], "notes": [str(days)]}
"""


def test_skills_from_another_root_and_invalid_headers(tmp_path: Path) -> None:
    _write_skill(tmp_path, "demo", _GOOD_HEADER, _GOOD_BODY, _GOOD_SCRIPT)
    _write_skill(tmp_path, "broken", "id: other\nversion: 1", _GOOD_BODY, _GOOD_SCRIPT)
    (tmp_path / "no-script").mkdir()
    (tmp_path / "no-script" / "SKILL.md").write_text("---\nid: no-script\n---\n")
    assert skill_ids(tmp_path) == ["broken", "demo"]
    demo = get_skill("demo", tmp_path)
    assert check_skill(demo, load_knowledge()) == []
    with pytest.raises(SkillError, match="must equal the folder name"):
        get_skill("broken", tmp_path)
    assert [s.id for s in sk.all_skills(tmp_path)] == ["demo"]  # broken one is skipped


_BAD_HEADER = """id: demo
version: 1
status: draft
name: Demo
summary: A demo skill.
tests_events: [no_such_event]
considers: [seasonal]
params:
  area: {type: area, auto: true, required: true}
  days: {type: int, default: 30, min: 14, max: 365}
  ghost: {type: string, default: null}
outputs: [timeline, chart]"""


def test_check_skill_reports_every_problem(tmp_path: Path, kb: KnowledgeBase) -> None:
    script = _GOOD_SCRIPT.replace('params.get("days", 60)', 'params.get("days", 60) + params["x"]')
    _write_skill(tmp_path, "demo", _BAD_HEADER, "\n## What it does\nx\n", script)
    problems = "\n".join(check_skill(get_skill("demo", tmp_path), kb))
    assert "missing '## When to use it'" in problems
    assert "missing '## Limits'" in problems
    assert "'ghost' is declared but run.py never reads it" in problems
    assert "run.py reads 'x' but SKILL.md does not declare it" in problems
    assert "'days' default 30 differs from run.py's 60" in problems
    assert "output 'chart' is not a block type" in problems
    assert "tests_events 'no_such_event' is not an event card" in problems
    assert "considers" not in problems  # seasonal is a card


def test_script_params_reads_explicit_signatures() -> None:
    script = (
        "def run(area, years=4, *, before=None, mode='fast', **rest):\n"
        "    return rest.get('x', 1)\n"
    )
    found = script_params(script)
    assert found == {
        "area": inspect.Parameter.empty,
        "years": 4,
        "before": None,
        "mode": "fast",
        "x": 1,
    }
    with pytest.raises(SkillError):
        script_params("def other():\n    pass\n")


# --- Params -------------------------------------------------------------------------------------


def test_prepare_params_injects_area_and_name(pond: Skill) -> None:
    out = prepare_params(
        pond,
        {"years": 5, "before": "2024-09-30", "after": None, "answers": {"use": "x"}},
        area=HOO_HOK_WAI.geojson,
        name="Hoo Hok Wai ponds",
    )
    assert out == {
        "years": 5,
        "before": "2024-09-30",
        "answers": {"use": "x"},
        "area": HOO_HOK_WAI.geojson,
        "name": "Hoo Hok Wai ponds",
    }
    assert prepare_params(pond, None, area=HOO_HOK_WAI.geojson, name=None) == {
        "area": HOO_HOK_WAI.geojson
    }
    assert prepare_params(pond, {"years": 4.0}, area=HOO_HOK_WAI.geojson, name=None)["years"] == 4


@pytest.mark.parametrize(
    ("params", "match"),
    [
        ({"radius": 3}, "Unknown param"),
        ({"area": {"type": "Polygon"}}, "set by the harness"),
        ({"name": "x"}, "set by the harness"),
        ({"years": 9}, "between 3 and 5"),
        ({"years": 2}, "between 3 and 5"),
        ({"years": True}, "whole number"),
        ({"years": 3.5}, "whole number"),
        ({"years": "4"}, "whole number"),
        ({"before": "30/09/2024"}, "YYYY-MM-DD"),
        ({"before": "2024-02-30"}, "YYYY-MM-DD"),
        ({"answers": ["a"]}, "JSON object"),
    ],
)
def test_prepare_params_rejects_bad_params(pond: Skill, params: dict, match: str) -> None:
    with pytest.raises(SkillParamError, match=match) as info:
        prepare_params(pond, params, area=HOO_HOK_WAI.geojson, name=None)
    assert info.value.message


def test_prepare_params_never_falls_back_to_the_preset(pond: Skill) -> None:
    """run.py would use the Hoo Hok Wai preset without an area: code refuses first."""
    with pytest.raises(SkillParamError, match="needs an outline") as info:
        prepare_params(pond, {}, area=None, name="Somewhere")
    assert "search_places" in (info.value.hint or "")


def test_prepare_params_checks_the_outline_size(pond: Skill) -> None:
    big = earth.Area.from_point(22.5, 114.0, radius_m=3_500)  # ~3,850 ha > 25 km²
    with pytest.raises(SkillParamError, match="at most 2500 ha"):
        prepare_params(pond, {}, area=big.geojson, name=None)
    with pytest.raises(SkillParamError, match="not usable"):
        prepare_params(pond, {}, area={"type": "Point", "coordinates": [0, 0]}, name=None)


# --- Findings convention ------------------------------------------------------------------------


def test_adapt_findings_keeps_conforming_findings() -> None:
    f = {"observed": {"water": {"value": 0.1}}, "x": 1}
    out = adapt_findings(POND, f)
    assert out == f and out is not f


def test_adapt_findings_maps_legacy_keys() -> None:
    f = {
        "water": {"before": 0.1, "after": -0.25, "delta": -0.35},
        "greenness": {"before": 0.4, "after": 0.1},
        "bare": {"before": -0.3, "after": 0.1, "delta": 0.4},
        "moisture": {"before": 0.2, "after": 0.25, "delta": 0.05},
        "change_dates": {"water": "2025-09-14", "bare": None, "greenness": "2025-08-14"},
        "local_vs_regional": {
            "water": {"verdict": "local"},
            "bare": {"verdict": "regional"},
            "greenness": {"verdict": "no notable change"},
        },
        "persistence": {"persists": False, "later_scenes": 5},
        "verdicts": {"pond_filling": "supported"},
    }
    obs = adapt_findings("some-old-skill", f)["observed"]
    assert set(obs) == {"water", "greenness", "bare", "moisture"}
    assert all(set(e) == set(OBSERVED_KEYS) for e in obs.values())
    w = obs["water"]
    assert (w["value"], w["before"], w["after"], w["delta"]) == (-0.25, 0.1, -0.25, -0.35)
    assert w["inside_band"] is False and w["date"] == "2025-09-14"
    assert w["local"] is True and w["persistent"] is False and w["sudden"] is None
    assert obs["greenness"]["delta"] == pytest.approx(-0.3)
    assert obs["greenness"]["local"] is None
    assert obs["bare"]["local"] is False and obs["bare"]["inside_band"] is None
    assert obs["moisture"]["date"] is None and obs["moisture"]["persistent"] is None


def test_adapt_findings_drops_echoed_answers() -> None:
    """Clarification answers can hold remembered values: never echoed into tool results."""
    out = adapt_findings(POND, {"answers": {"use": "fish ponds"}, "observed": {}, "x": 1})
    assert out == {"observed": {}, "x": 1}
    out = adapt_findings(POND, {"answers": {"use": "fish ponds"}, "water": {"after": -0.2}})
    assert "answers" not in out and out["observed"]["water"]["value"] == -0.2


def test_adapt_findings_of_a_limited_run_has_no_observations() -> None:
    out = adapt_findings(POND, {"limited": True, "reason": "area_too_small"})
    assert out == {"limited": True, "reason": "area_too_small", "observed": {}}


# --- Stub sandbox run ---------------------------------------------------------------------------


def test_stub_run_returns_findings_in_the_convention(preset_outcome: RunOutcome) -> None:
    out = preset_outcome
    assert out.ok, out.error
    assert 0 < len(out.calls) <= 30
    f = out.result.findings
    obs = f["observed"]
    assert isinstance(obs, dict)
    assert {"water", "bare", "moisture", "greenness"} <= set(obs)
    assert set(obs) <= set(ALL_MEASURES)
    for entry in obs.values():
        assert set(entry) == set(OBSERVED_KEYS)
    assert obs["water"]["delta"] == f["water"]["delta"]
    assert obs["water"]["value"] == f["water"]["after"]
    assert obs["water"]["date"] == f["change_dates"]["water"]
    assert "answers" not in f
    blocks = [validate_block(b.model_dump(mode="json")) for b in out.result.blocks]
    assert sum(b.primary for b in blocks) == 1


# --- tests.yaml ---------------------------------------------------------------------------------


def _get(data: Any, path: str) -> Any:
    for part in path.split("."):
        assert isinstance(data, dict) and part in data, f"missing {path}"
        data = data[part]
    return data


def _check(actual: Any, expected: Any, path: str) -> None:
    if isinstance(expected, dict):
        (op, value), *rest = expected.items()
        assert not rest, path
        if op == "lt":
            assert actual is not None and actual < value, (path, actual)
        elif op == "le":
            assert actual is not None and actual <= value, (path, actual)
        elif op == "gt":
            assert actual is not None and actual > value, (path, actual)
        elif op == "ge":
            assert actual is not None and actual >= value, (path, actual)
        elif op == "not":
            assert actual != value, (path, actual)
        else:
            raise AssertionError(f"unknown op {op} at {path}")
    else:
        assert actual == expected, (path, actual)


PRESET_CASES = [c for c in TESTS_YAML["cases"] if c["kind"] == "preset"]
CARD_CASES = [c for c in TESTS_YAML["cases"] if c["kind"] == "card_case"]


def test_tests_yaml_shape(pond: Skill) -> None:
    assert TESTS_YAML["version"] == 1
    assert TESTS_YAML["skill"] == pond.id
    ids = [c["id"] for c in TESTS_YAML["cases"]]
    assert len(ids) == len(set(ids))
    assert {c["kind"] for c in TESTS_YAML["cases"]} == {"preset", "card_case"}
    assert any(c["id"] == "hoo_hok_wai_preset" for c in PRESET_CASES)


@pytest.mark.parametrize("case", CARD_CASES, ids=[c["id"] for c in CARD_CASES])
def test_card_cases_point_at_real_card_cases(case: dict, pond: Skill, kb: KnowledgeBase) -> None:
    assert case["card"] in pond.tests_events + pond.considers
    card = kb.events[case["card"]]
    group = getattr(card, case["group"])
    assert 0 <= case["index"] < len(group)
    assert group[case["index"]].expected == case["expected"]
    assert case["earth_impl"] == "real"
    target = group[case["index"]]
    area = earth.Area.from_point(target.lat, target.lon, radius_m=case["radius_m"])
    prepare_params(pond, case.get("params") or {}, area=area.geojson, name=target.place)


def test_every_card_case_and_control_is_referenced(pond: Skill, kb: KnowledgeBase) -> None:
    card = kb.events["pond_filling"]
    refs = {(c["group"], c["index"]) for c in CARD_CASES if c["card"] == "pond_filling"}
    want = {("cases", i) for i in range(len(card.cases))}
    want |= {("controls", i) for i in range(len(card.controls))}
    assert refs == want


def _case_area(spec: Any) -> earth.Area:
    if isinstance(spec, str):
        return getattr(earth.presets, spec)
    return earth.Area.from_point(spec["lat"], spec["lon"], radius_m=spec["radius_m"])


@pytest.mark.parametrize("case", PRESET_CASES, ids=[c["id"] for c in PRESET_CASES])
def test_preset_cases_hold_under_the_stub(
    case: dict, pond: Skill, stub_env: None, preset_outcome: RunOutcome
) -> None:
    assert case["earth_impl"] == "stub"
    area = _case_area(case["area"])
    if case["area"] == "HOO_HOK_WAI" and not case["params"]:
        out = preset_outcome  # same run, done once for the module
    else:
        out = _run(pond, case["params"], area.geojson, area.name)
    expect = case["expect"]
    assert out.ok is expect["ok"], out.error
    findings = out.result.findings
    for path, want in (expect.get("findings") or {}).items():
        _check(_get(findings, path), want, path)
    for path, want in (expect.get("observed") or {}).items():
        _check(_get(findings["observed"], path), want, f"observed.{path}")
    types = [b.type for b in out.result.blocks]
    if expect["blocks"] == ["limits"]:
        assert types == ["limits"]
    else:
        assert set(expect["blocks"]) <= set(types)
    if "primary" in expect:
        assert [b.type for b in out.result.blocks if b.primary] == [expect["primary"]]
