"""Contract tests for the sandbox runner (BUILD-PLAN I2). Stub earth, no network."""

from __future__ import annotations

import asyncio
import time

import pytest

from app.services.sandbox import child_env, run_script


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))


def run(script: str, **kw):
    return asyncio.run(run_script(script, kw.pop("params", {}), "r_test", **kw))


GOOD = """
import earth
from earth.presets import HOO_HOK_WAI

def run(**params):
    print("stray output that must not break parsing")
    s = earth.series(HOO_HOK_WAI, "greenness", years=2)
    c = earth.compare(HOO_HOK_WAI, "bare", before="2026-03-01", after="2026-09-30")
    return {
        "findings": {"delta": c.delta, "n": len(s.points), "p": params.get("p")},
        "evidence": [{"measure": "bare", "value": c.after.mean}],
        "blocks": [
            earth.show.timeline(s, title="Greenness"),
            earth.show.stat("Area changed", c.changed_ha, "ha"),
        ],
        "notes": ["ok"],
    }
"""


def test_good_script_streams_calls_in_order():
    seen = []

    async def on_call(call):
        seen.append(call)

    out = run(GOOD, params={"p": 7}, on_call=on_call)
    assert out.ok, out.error
    assert [c.fn for c in out.calls] == ["series", "compare"]
    assert seen == out.calls
    assert out.result.findings["p"] == 7
    assert [b.type for b in out.result.blocks] == ["timeline", "stat"]
    assert out.result.notes == ["ok"]


@pytest.mark.parametrize(
    "body",
    [
        "import os\ndef run(**p):\n    return {}",
        "from os import path\ndef run(**p):\n    return {}",
        "import earth._stub\ndef run(**p):\n    return {}",
        "from earth import settings\ndef run(**p):\n    return {}",
        "import earth\ndef run(**p):\n    earth.calls.set_listener(None)\n    return {}",
        "def run(**p):\n    open('x')",
        "import numpy\ndef run(**p):\n    return {'k': str(numpy.loadtxt('.env', dtype=str))}",
        "def run(**p):\n    return __import__('os')",
        "def run(**p):\n    return ().__class__",
        "def run(**p):\n    return eval('1')",
        "def run(**p):\n    return getattr(p, 'x')",
        "x = 1\n",  # no run()
        "def run(:\n",  # syntax error
        "def run(**p):\n    return {}\n" + "x = 1\n" * 300,  # too long
    ],
)
def test_scan_rejects_without_starting_child(body):
    start = time.monotonic()
    out = run(body)
    assert not out.ok and out.error.kind == "scan"
    assert out.error.hint
    assert out.calls == []
    assert time.monotonic() - start < 1


def test_scan_names_line_number():
    out = run("import math\n\nimport os\ndef run(**p):\n    return {}")
    assert "line 3" in out.error.message


def test_crash_has_traceback_tail():
    out = run("def run(**p):\n    raise ValueError('boom')")
    assert out.error.kind == "crash"
    assert "ValueError" in out.error.traceback_tail
    assert "boom" in out.error.message


@pytest.mark.parametrize(
    "ret",
    ["[1, 2]", "{'findings': {}, 'evidence': [], 'blocks': [{'type': 'nope', 'id': 'b'}]}"],
)
def test_wrong_shape(ret):
    out = run(f"def run(**p):\n    return {ret}")
    assert out.error.kind == "shape"
    assert out.error.hint


def test_budget_error_has_hint_and_keeps_calls():
    script = """
import earth
from earth.presets import HOO_HOK_WAI

def run(**params):
    return earth.series(HOO_HOK_WAI, "greenness", years=10)
"""
    out = run(script)
    assert out.error.kind == "budget"
    assert out.error.hint
    assert [c.error for c in out.calls] == ["budget_exceeded"]


def test_timeout_kills_child():
    start = time.monotonic()
    out = run("def run(**p):\n    while True:\n        pass", timeout_s=2)
    assert out.error.kind == "timeout"
    assert out.error.hint
    assert time.monotonic() - start < 5


def test_child_env_has_no_secrets(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-secret")
    monkeypatch.setenv("SOME_OTHER_TOKEN", "x")
    monkeypatch.setenv("EARTH_IMPL", "stub")
    env = child_env("r1")
    assert "sk-secret" not in env.values()
    allowed = {"PATH", "PYTHONPATH", "HOME", "TMPDIR", "EARTH_IMPL", "EARTH_DATA_DIR", "RUN_ID"}
    assert set(env) <= allowed
    assert env["RUN_ID"] == "r1" and env["EARTH_IMPL"] == "stub"
