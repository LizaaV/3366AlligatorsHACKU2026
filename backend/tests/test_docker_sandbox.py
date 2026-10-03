"""Docker sandbox (SANDBOX_IMPL=docker, opt-in): earth client/service + container isolation.

The first part always runs (no Docker). The container tests need Docker and build the image:
    DOCKER_SANDBOX_TESTS=1 uv run pytest tests/test_docker_sandbox.py -s
(`sandbox/dev-up.sh` builds the image, the internal `earth-only` network and the local relay.)
The runner contract tests also pass in the container:
    SANDBOX_IMPL=docker uv run pytest tests/contracts/test_runner.py \
        tests/test_skill_pond_filling.py
"""

from __future__ import annotations

import asyncio
import importlib.util
import inspect
import json
import os
import shutil
import statistics
import subprocess
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import earth
from app.core.config import settings
from app.services import earth_service
from app.services.sandbox import run_script
from earth.presets import HOO_HOK_WAI
from tests.contracts.test_runner import GOOD

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("EARTH_IMPL", "stub")


def _client_module():
    spec = importlib.util.spec_from_file_location("earth_client_check", BACKEND / "earth/client.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod  # pydantic resolves annotations through sys.modules
    spec.loader.exec_module(mod)
    return mod


# --- client ↔ earth stay in sync (no Docker) ----------------------------------------------------


def test_client_exposes_the_same_public_api_as_earth():
    client = _client_module()
    assert client.__all__ == earth.__all__
    for name in earth_service.allowed_functions():
        real = inspect.signature(getattr(earth, name).__wrapped__)
        mine = inspect.signature(getattr(client, name))
        assert [(p.name, p.default) for p in mine.parameters.values()] == [
            (p.name, p.default) for p in real.parameters.values()
        ], name
    for name in ("PlaceHit", "RainSeries"):
        assert getattr(client, name).model_json_schema() == getattr(earth, name).model_json_schema()


def test_service_allows_only_traced_public_functions():
    allowed = earth_service.allowed_functions()
    assert {"scenes", "load", "series", "compare", "render", "weather"} <= allowed
    assert not allowed & {"set_run", "set_listener", "validate_block", "Area", "show"}


@pytest.mark.parametrize(
    "fn",
    ["parse_raw", "parse_file", "model_construct", "Area", "Area.parse_raw", "__init__", "_impl"],
)
def test_service_never_dispatches_methods_or_internals(fn):
    def go(s):
        h = {"Authorization": f"Bearer {s.token}"}
        body = {"kwargs": {"b": "x", "proto": "pickle"}}
        return TestClient(earth_service.app).post(f"/call/{fn}", json=body, headers=h).status_code

    assert _with_session(go) == 404


# --- earth service (no Docker) ------------------------------------------------------------------


def _with_session(fn):
    async def go():
        s = earth_service.open_session("r_svc")
        try:
            return await asyncio.to_thread(fn, s)
        finally:
            earth_service.close_session(s)

    return asyncio.run(go())


def _area_json():
    return HOO_HOK_WAI.model_dump(mode="json")


def test_service_needs_the_run_token():
    http = TestClient(earth_service.app)
    body = {"kwargs": {"area": _area_json()}}
    assert http.post("/call/describe", json=body).status_code == 401
    assert (
        http.post("/call/describe", json=body, headers={"Authorization": "Bearer x"}).status_code
        == 401
    )

    def authed(s):
        h = {"Authorization": f"Bearer {s.token}"}
        return (
            http.post("/call/describe", json=body, headers=h).json(),
            http.post("/call/set_run", json={"kwargs": {}}, headers=h).status_code,
        )

    ok, not_allowed = _with_session(authed)
    assert ok["ok"]["area_ha"] == HOO_HOK_WAI.area_ha
    assert not_allowed == 404


def test_service_logs_calls_and_keeps_the_budget_per_run():
    def many(s):
        outs = [earth_service.call(s, "describe", {"area": _area_json()}) for _ in range(31)]
        return outs, list(s.calls)

    outs, calls = _with_session(many)
    assert all("ok" in o for o in outs[:30])
    assert outs[30]["error"]["kind"] == "budget_exceeded"
    assert [c.error for c in calls][-1] == "budget_exceeded" and len(calls) == 31
    # another run starts from zero
    assert "ok" in _with_session(
        lambda s: earth_service.call(s, "describe", {"area": _area_json()})
    )


def test_service_remeasures_areas_and_refuses_foreign_layers():
    forged = {**_area_json(), "area_ha": 0.5}  # claims to be tiny; the outline is ~38 ha

    def go(s):
        d = earth_service.call(s, "describe", {"area": forged})
        sl = earth_service.call(s, "scenes", {"area": _area_json()})
        scene = sl["ok"]["scenes"][0]
        layer = earth_service.call(s, "load", {"area": _area_json(), "scene": scene})["ok"]
        mine = earth_service.call(s, "index", {"layer": layer, "measure": "greenness"})
        foreign = earth_service.call(s, "measure", {"layer": {**layer, "id": "L999999"}})
        bad_type = earth_service.call(s, "series", {"area": _area_json(), "nope": 1})
        return d, mine, foreign, bad_type

    d, mine, foreign, bad_type = _with_session(go)
    assert d["ok"]["area_ha"] == HOO_HOK_WAI.area_ha
    assert "ok" in mine
    assert "Unknown layer" in foreign["error"]["message"]
    assert bad_type["error"]["kind"] == "type_error"


# --- containers (DOCKER_SANDBOX_TESTS=1) --------------------------------------------------------


def _docker_ok() -> bool:
    if os.environ.get("DOCKER_SANDBOX_TESTS") != "1" or not shutil.which("docker"):
        return False
    return subprocess.run(["docker", "info"], capture_output=True, timeout=20).returncode == 0


docker = pytest.mark.skipif(not _docker_ok(), reason="set DOCKER_SANDBOX_TESTS=1 (needs Docker)")


@pytest.fixture(scope="module")
def sandbox_ready():
    subprocess.run(["sh", "sandbox/dev-up.sh"], cwd=BACKEND, check=True, timeout=600)


@pytest.fixture
def in_docker(sandbox_ready, monkeypatch):
    monkeypatch.setattr(settings, "sandbox_impl", "docker")


def _run(script: str, **kw):
    return asyncio.run(run_script(script, kw.pop("params", {}), "r_docker", **kw))


def _sandbox_containers() -> list[str]:
    out = subprocess.run(
        ["docker", "ps", "-aq", "--filter", "label=earth-sandbox=1"], capture_output=True, text=True
    )
    return out.stdout.split()


@docker
def test_good_script_streams_calls_from_the_service(in_docker):
    seen = []

    async def on_call(call):
        seen.append(call)

    out = _run(GOOD, params={"p": 7}, on_call=on_call)
    assert out.ok, out.error
    assert [c.fn for c in out.calls] == ["series", "compare"]
    assert seen == out.calls
    assert out.result.findings["p"] == 7
    assert [b.type for b in out.result.blocks] == ["timeline", "stat"]


@docker
def test_errors_keep_their_kinds(in_docker):
    crash = _run("def run(**p):\n    raise ValueError('boom')")
    assert crash.error.kind == "crash" and "ValueError" in crash.error.traceback_tail
    assert _run("def run(**p):\n    return [1]").error.kind == "shape"
    budget = _run(
        "import earth\nfrom earth.presets import HOO_HOK_WAI\n"
        "def run(**p):\n    return earth.series(HOO_HOK_WAI, 'greenness', years=10)"
    )
    assert budget.error.kind == "budget" and budget.error.earth_kind == "budget_exceeded"
    assert [c.error for c in budget.calls] == ["budget_exceeded"]
    small = _run(
        "import earth\ndef run(**p):\n"
        "    earth.load(earth.Area.from_point(22.5, 114.0, radius_m=20),\n"
        "               earth.scenes(earth.presets.HOO_HOK_WAI).latest_clear())\n"
    )
    assert small.error.kind == "crash" and small.error.earth_kind == "area_too_small"
    assert _run("import os\ndef run(**p):\n    return {}").error.kind == "scan"


@docker
def test_timeout_kills_the_container(in_docker):
    start = time.monotonic()
    out = _run("def run(**p):\n    while True:\n        pass", timeout_s=2)
    assert out.error.kind == "timeout"
    assert time.monotonic() - start < 5
    for _ in range(20):
        if not _sandbox_containers():
            break
        time.sleep(0.25)
    assert _sandbox_containers() == []


@docker
def test_pond_filling_skill_runs_in_the_container(in_docker):
    script = (BACKEND / "skills/pond-filling-check/run.py").read_text()
    out = _run(script, params={"answers": {"use": "fish ponds", "watching_for": "filling"}})
    assert out.ok, out.error
    assert len(out.result.blocks) == 6
    assert out.result.findings["top_hypothesis"] == "pond_filling"
    assert all(c.error is None for c in out.calls)


PROBE = r"""
import json, os, socket, urllib.request
def can(f):
    try:
        f(); return True
    except Exception:
        return False
def write(p):
    with open(p, "w") as fh: fh.write("x")
print(json.dumps({
    "uid": os.getuid(),
    "internet_ip": can(lambda: socket.create_connection(("1.1.1.1", 53), timeout=3)),
    "internet_dns": can(lambda: socket.getaddrinfo("example.com", 443)),
    "host_gateway": can(lambda: socket.create_connection(
        ("host.docker.internal", HOST_PORT), timeout=3)),
    "earth_service": can(lambda: urllib.request.urlopen(
        os.environ["EARTH_SERVICE_URL"] + "/health", timeout=3)),
    "write_root": can(lambda: write("/sandbox/x")),
    "write_tmp": can(lambda: write("/tmp/x")),
    "host_paths": [p for p in ("/Users", "/home/app", "/var/run/docker.sock", "/data")
                   if os.path.exists(p)],
    "env": sorted(os.environ),
    "leaked": [k for k, v in os.environ.items() if "sk-must-not-leak" in v],
    "earth_files": sorted(os.listdir("/sandbox/earth")),
}))
"""


def _docker_exec(cmd: list[str], **env: str) -> subprocess.CompletedProcess:
    from app.services.sandbox_docker import docker_cli_env, docker_run_args

    args = docker_run_args(
        f"earth-probe-{os.getpid()}", settings.sandbox_image, settings.sandbox_network, cmd
    )
    return subprocess.run(
        ["docker", *args],
        env=docker_cli_env(
            RUN_ID="r_probe",
            EARTH_SERVICE_URL=settings.earth_service_url,
            EARTH_TOKEN="t",
            ANTHROPIC_API_KEY="sk-must-not-leak",
            **env,
        ),
        capture_output=True,
        text=True,
        timeout=60,
        stdin=subprocess.DEVNULL,
    )


@docker
def test_container_is_isolated(sandbox_ready):
    earth_service.ensure_started(settings.earth_service_host, settings.earth_service_port)
    probe = PROBE.replace("HOST_PORT", str(settings.earth_service_port))
    res = _docker_exec(["python", "-c", probe])
    assert res.returncode == 0, res.stderr
    p = json.loads(res.stdout)
    print("\nisolation probe:", p)
    assert p["uid"] != 0
    assert not p["internet_ip"] and not p["internet_dns"] and not p["host_gateway"]
    assert p["earth_service"]  # the only thing it can reach
    assert not p["write_root"] and p["write_tmp"]
    assert p["host_paths"] == []
    assert p["leaked"] == [] and "ANTHROPIC_API_KEY" not in p["env"]
    assert "providers" not in p["earth_files"] and "real.py" not in p["earth_files"]


@docker
def test_memory_limit_is_enforced(sandbox_ready):
    res = _docker_exec(
        ["python", "-c", "b = bytearray(1500 * 1024 * 1024); b[::4096] = b'x' * len(b[::4096])"]
    )
    assert res.returncode == 137, (res.returncode, res.stderr[-300:])


@docker
def test_startup_overhead(in_docker, monkeypatch):
    trivial = "def run(**p):\n    return {'findings': {}, 'evidence': [], 'blocks': []}"
    _run(trivial)  # warm the earth service

    def timed(n=5):
        ts = []
        for _ in range(n):
            t = time.monotonic()
            assert _run(trivial).ok
            ts.append(time.monotonic() - t)
        return statistics.median(ts)

    docker_s = timed()
    monkeypatch.setattr(settings, "sandbox_impl", "subprocess")
    sub_s = timed()
    print(
        f"\nstart-up (trivial script, median of 5): "
        f"docker {docker_s:.2f} s, subprocess {sub_s:.2f} s"
    )
    assert docker_s < 2.0  # HANDOFF B11.3: first step < 2 s


@docker
def test_in_container_child_disables_pickle(sandbox_ready):
    code = (
        "from app.services.sandbox_child import _disable_deserialisers\n"
        "_disable_deserialisers()\n"
        "import pickle\n"
        "pickle.loads(b'\\x80\\x04N.')\n"
    )
    res = _docker_exec(["python", "-c", code])
    assert res.returncode != 0 and "PermissionError" in res.stderr
