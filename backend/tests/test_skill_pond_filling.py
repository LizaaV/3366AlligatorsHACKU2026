"""Skill `pond-filling-check` (BUILD-PLAN S1): scan, stub run, limits, optional network run.

EARTH_NETWORK_TESTS=1 EARTH_IMPL=real uv run pytest tests/test_skill_pond_filling.py -s
"""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

import pytest

from app.services.sandbox import run_script, scan_script
from earth.blocks import validate_block

SCRIPT = (Path(__file__).resolve().parents[1] / "skills/pond-filling-check/run.py").read_text()


@pytest.fixture(autouse=True)
def _offline(tmp_path, monkeypatch):
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("EARTH_IMPL", os.environ.get("EARTH_IMPL", "stub"))


def _run(params: dict, timeout_s: int = 60):
    return asyncio.run(run_script(SCRIPT, params, "r_test", timeout_s=timeout_s))


def test_script_passes_the_sandbox_scan():
    assert scan_script(SCRIPT) is None


def test_stub_run_tells_the_hoo_hok_wai_story():
    out = _run({"answers": {"use": "fish ponds", "watching_for": "filling"}})
    assert out.ok, out.error
    assert 0 < len(out.calls) <= 30
    assert all(c.error is None for c in out.calls)
    res = out.result
    assert res is not None
    f = res.findings
    assert f["changed_ha"] > 5
    assert f["change_date"] is not None
    assert f["local_vs_regional"]["water"]["verdict"] == "local"
    assert f["top_hypothesis"] == "pond_filling"
    assert f["verdicts"]["pond_filling"] == "supported"
    assert f["verdicts"]["seasonal"] == "contradicted"
    assert f["verdicts"]["construction"] != "supported"  # needs radar / later change
    assert f["answers"]["watching_for"] == "filling"
    assert res.evidence and all(
        {"measure", "value", "date", "scene"} <= e.keys() for e in res.evidence
    )
    assert any("radar" in n for n in res.notes)

    blocks = [validate_block(b.model_dump(mode="json")) for b in res.blocks]
    types = [b.type for b in blocks]
    assert len(blocks) <= 6
    assert sum(b.primary for b in blocks) == 1
    assert {"then_now", "timeline", "highlight", "stat", "hypotheses"} <= set(types)
    rows = next(b for b in blocks if b.type == "hypotheses").rows
    assert rows[0].card_id == "pond_filling"
    assert rows[0].verdict == "supported"
    assert all(r.expected and r.observed for r in rows)


def test_area_param_accepts_point_and_geojson_and_dates():
    out = _run({"area": {"lat": 22.534, "lon": 114.09, "radius_m": 250}, "name": "My ponds"})
    assert out.ok, out.error
    assert out.result.findings["area_ha"] == pytest.approx(19.6, abs=1.0)
    poly = {
        "type": "Polygon",
        "coordinates": [
            [
                [114.09, 22.53],
                [114.095, 22.53],
                [114.095, 22.535],
                [114.09, 22.535],
                [114.09, 22.53],
            ]
        ],
    }
    out = _run({"area": poly, "before": "2024-09-30", "after": "2026-09-25", "years": 3})
    assert out.ok, out.error
    assert out.result.findings["before"] == "2024-09-30"
    assert out.result.findings["after"] == "2026-09-25"


def test_tiny_area_degrades_to_a_limits_block():
    out = _run({"area": {"lat": 22.534, "lon": 114.09, "radius_m": 15}})
    assert out.ok, out.error
    assert out.result.findings["limited"] is True
    assert out.result.findings["reason"] == "area_too_small"
    assert [b.type for b in out.result.blocks] == ["limits"]
    assert out.result.notes


@pytest.mark.skipif(
    os.environ.get("EARTH_NETWORK_TESTS") != "1", reason="needs network: EARTH_NETWORK_TESTS=1"
)
def test_real_run_any_area():
    if os.environ.get("EARTH_IMPL") != "real":
        pytest.skip("set EARTH_IMPL=real")
    t0 = time.monotonic()
    out = _run({"area": {"lat": 22.534, "lon": 114.09, "radius_m": 300}}, timeout_s=300)
    took = time.monotonic() - t0
    print(f"real run: ok={out.ok} calls={len(out.calls)} in {took:.0f} s")
    if not out.ok and "not built yet" in (out.error.message if out.error else ""):
        pytest.xfail("real series/compare (M2) not on main yet")
    assert out.ok, out.error
    assert len(out.calls) <= 30
