"""The question skills beside pond-filling-check (BUILD-PLAN S1): greenness-check,
tree-cover-change, new-building-check, heat-check. Each must pass the registry's checks
and its own tests.yaml preset cases in the sandbox. Offline: EARTH_IMPL=stub, no LLM."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml

import earth
from app.services.agent import skills as sk
from app.services.agent.skills import (
    OBSERVED_KEYS,
    check_skill,
    get_skill,
    prepare_params,
    run_skill_script,
    skill_ids,
)
from earth.blocks import validate_block
from knowledge import ALL_MEASURES, KnowledgeBase, load_knowledge

SKILLS = ["greenness-check", "tree-cover-change", "new-building-check", "heat-check"]
ROOT = Path(__file__).resolve().parents[1] / "skills"


def _yaml(sid: str) -> dict:
    return yaml.safe_load((ROOT / sid / "tests.yaml").read_text(encoding="utf-8"))


CASES = [(sid, c) for sid in SKILLS for c in _yaml(sid)["cases"] if c["kind"] == "preset"]


@pytest.fixture(scope="module")
def kb() -> KnowledgeBase:
    return load_knowledge()


@pytest.fixture(scope="module")
def stub_env(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("EARTH_IMPL", "stub")
        mp.setenv("EARTH_DATA_DIR", str(tmp_path_factory.mktemp("earth_data")))
        yield


@pytest.mark.parametrize("sid", SKILLS)
def test_skill_is_listed_and_valid(sid: str, kb: KnowledgeBase) -> None:
    sk.clear_cache()
    assert sid in skill_ids()
    skill = get_skill(sid)
    assert check_skill(skill, kb) == []
    assert skill.params["area"].auto and skill.params["area"].required
    assert len(skill.script.splitlines()) <= 300


@pytest.mark.parametrize("sid", SKILLS)
def test_tests_yaml_shape(sid: str) -> None:
    data = _yaml(sid)
    assert data["version"] == 1 and data["skill"] == sid
    ids = [c["id"] for c in data["cases"]]
    assert len(ids) == len(set(ids))
    assert "hoo_hok_wai_preset" in ids


def _get(data: Any, path: str) -> Any:
    for part in path.split("."):
        assert isinstance(data, dict) and part in data, f"missing {path}"
        data = data[part]
    return data


def _check(actual: Any, expected: Any, path: str) -> None:
    if isinstance(expected, dict):
        (op, value), *_ = expected.items()
        ok = {
            "lt": lambda: actual is not None and actual < value,
            "le": lambda: actual is not None and actual <= value,
            "gt": lambda: actual is not None and actual > value,
            "ge": lambda: actual is not None and actual >= value,
            "not": lambda: actual != value,
        }[op]()
        assert ok, (path, actual)
    else:
        assert actual == expected, (path, actual)


def _area(spec: Any) -> earth.Area:
    if isinstance(spec, str):
        return getattr(earth.presets, spec)
    return earth.Area.from_point(spec["lat"], spec["lon"], radius_m=spec["radius_m"])


@pytest.mark.parametrize(("sid", "case"), CASES, ids=[f"{s}:{c['id']}" for s, c in CASES])
def test_preset_cases_hold_under_the_stub(sid: str, case: dict, stub_env: None) -> None:
    assert case["earth_impl"] == "stub"
    skill = get_skill(sid)
    area = _area(case["area"])
    prepared = prepare_params(skill, case["params"], area=area.geojson, name=area.name)
    out = asyncio.run(run_skill_script(sid, prepared, "r_skilltest"))
    expect = case["expect"]
    assert out.ok is expect["ok"], out.error
    assert 0 < len(out.calls) <= 30
    findings = out.result.findings
    assert "answers" not in findings
    obs = findings["observed"]
    assert set(obs) <= set(ALL_MEASURES)
    for entry in obs.values():
        assert set(entry) == set(OBSERVED_KEYS)
    for path, want in (expect.get("findings") or {}).items():
        _check(_get(findings, path), want, path)
    for path, want in (expect.get("observed") or {}).items():
        _check(_get(obs, path), want, f"observed.{path}")
    blocks = [validate_block(b.model_dump(mode="json")) for b in out.result.blocks]
    types = [b.type for b in blocks]
    assert len(blocks) <= 6
    if expect["blocks"] == ["limits"]:
        assert types == ["limits"]
    else:
        assert set(expect["blocks"]) <= set(types)
        assert sum(b.primary for b in blocks) == 1
    if "primary" in expect:
        assert [b.type for b in blocks if b.primary] == [expect["primary"]]
