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


# --- Escapes found by the Phase 1 integration test ----------------------------------------------

ESCAPES = [
    "import earth\ndef run(**p):\n    return earth.importlib.import_module('builtins')",
    "from earth import importlib\ndef run(**p):\n    return {}",
    "import statistics\ndef run(**p):\n    return statistics.sys",
    "import json\ndef run(**p):\n    return json.codecs",
    "import earth\ndef run(**p):\n    return earth.show.uuid",
    "from earth import show\ndef run(**p):\n    return show.uuid",
    "import earth as e\ndef run(**p):\n    return e.Transformer",
    "from earth.types import json\ndef run(**p):\n    return {}",
    "def run(**p):\n    return '{0.x}'.format(p)",
    "def run(**p):\n    g = (i for i in [1])\n    return g.gi_frame.f_globals",
    "def run(**p):\n    return type(p)",
    "class A:\n    pass\ndef run(**p):\n    return {}",
    "def run(**p):\n    return p._x",
]


@pytest.mark.parametrize("body", ESCAPES)
def test_known_escapes_are_rejected_by_the_scan(body):
    out = run(body)
    assert not out.ok and out.error.kind == "scan", out.error


def test_module_internals_are_unreachable_at_runtime_even_if_the_scan_misses():
    # Aliasing a module past the scan: the script only ever holds a proxy of public names.
    script = (
        "import earth\n"
        "def run(**p):\n"
        "    m = [earth][0]\n"
        "    return {'findings': {'x': str(m.importlib)}, 'evidence': [], 'blocks': []}\n"
    )
    out = run(script)
    assert not out.ok and out.error.kind == "crash"
    assert "importlib" in out.error.message


def test_builtins_are_restricted_at_runtime():
    script = (
        "def run(**p):\n"
        "    b = [__builtins__][0] if False else None\n"
        "    return {'findings': {'open': 'open' in dir()}, 'evidence': [], 'blocks': []}\n"
    )
    # `__builtins__` is rejected by the scan; dir() shows no `open` in the script's scope.
    assert run(script).error.kind == "scan"


def test_earth_error_kind_is_passed_through_for_the_fix_loop():
    script = (
        "import earth\n"
        "def run(**p):\n"
        "    earth.load(earth.Area.from_point(22.5, 114.0, radius_m=20),\n"
        "               earth.scenes(earth.presets.HOO_HOK_WAI).latest_clear())\n"
    )
    out = run(script)
    assert out.error.kind == "crash"
    assert out.error.earth_kind == "area_too_small"
    assert out.error.hint


def test_nan_in_findings_becomes_null():
    script = (
        "def run(**p):\n"
        "    return {'findings': {'x': float('nan')}, 'evidence': [], 'blocks': []}\n"
    )
    out = run(script)
    assert out.ok, out.error
    assert out.result.findings == {"x": None}


@pytest.mark.parametrize("bad_id", ["../../evil", "R1", "", "a/b"])
def test_run_id_is_validated(bad_id):
    with pytest.raises(ValueError):
        asyncio.run(run_script(GOOD, {}, bad_id))
