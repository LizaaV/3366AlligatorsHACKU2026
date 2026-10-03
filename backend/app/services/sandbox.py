"""Sandbox runner (HANDOFF B2, BUILD-PLAN I2): runs an agent-written script in a child process.

Walls: (1) AST scan before anything runs, (2) a child process with a minimal environment, a
wall-clock timeout and a CPU rlimit. A Docker implementation can replace the spawn later
(SANDBOX_IMPL=docker); `run_script` keeps the same signature.
"""

from __future__ import annotations

import ast
import asyncio
import contextlib
import functools
import json
import os
import re
import signal
import sys
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ValidationError

from earth.blocks import Block
from earth.types import EarthCall

BACKEND_DIR = Path(__file__).resolve().parents[2]
MAX_LINES = 300
RUN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

CALL = "@@EARTH_CALL "
RESULT = "@@RESULT "
ERROR = "@@ERROR "


class ScriptError(BaseModel):
    kind: Literal["scan", "crash", "shape", "budget", "timeout"]
    message: str
    hint: str | None = None
    traceback_tail: str | None = None  # last ~20 lines, for the agent's fix loop
    earth_kind: str | None = None  # e.g. "no_clear_scenes", "area_too_small" (EarthError.kind)


class ScriptResult(BaseModel):  # HANDOFF B2.3
    findings: dict
    evidence: list[dict]
    blocks: list[Block]
    notes: list[str] = []


class RunOutcome(BaseModel):
    ok: bool
    result: ScriptResult | None
    error: ScriptError | None
    calls: list[EarthCall]


# --- AST scan -----------------------------------------------------------------------------------

# What a script can see. The child hands the script proxies holding ONLY these names, so
# module internals (earth.importlib, statistics.sys, json.codecs, ...) are unreachable at runtime;
# the scan rejects the rest before anything runs. Docker (SANDBOX_IMPL=docker) is the outer wall.
_PRIVATE_EARTH = {"set_listener", "set_run"}
SUBMODULES = {("earth", "show"): "earth.show", ("earth", "presets"): "earth.presets"}
_BANNED_NAMES = {
    "eval",
    "exec",
    "compile",
    "open",
    "getattr",
    "setattr",
    "delattr",
    "globals",
    "locals",
    "vars",
    "breakpoint",
    "input",
    "type",
    "help",
    "exit",
    "quit",
    "memoryview",
    "object",
    "super",
    "classmethod",
    "staticmethod",
    "property",
}
# Attributes that lead from ordinary objects to frames, code or module globals
_BANNED_ATTRS = {
    "gi_frame",
    "gi_code",
    "gi_yieldfrom",
    "cr_frame",
    "cr_code",
    "cr_await",
    "ag_frame",
    "ag_code",
    "f_globals",
    "f_locals",
    "f_builtins",
    "f_back",
    "f_code",
    "tb_frame",
    "tb_next",
    "format",
    "format_map",
    "mro",
}


@functools.cache
def public_names() -> dict[str, frozenset[str]]:
    """Module → names a script may use. Shared with the child, which builds proxies from it."""
    import datetime
    import json as json_mod
    import math
    import statistics

    import earth
    import earth.presets
    import earth.show

    show = {
        n
        for n, v in vars(earth.show).items()
        if not n.startswith("_") and callable(v) and getattr(v, "__module__", "") == "earth.show"
    }
    return {
        "earth": frozenset(set(earth.__all__) - _PRIVATE_EARTH | {"presets"}),
        "earth.show": frozenset(show),
        "earth.presets": frozenset(n for n in vars(earth.presets) if n.isupper()),
        "math": frozenset(n for n in dir(math) if not n.startswith("_")),
        "statistics": frozenset(statistics.__all__),
        "datetime": frozenset(datetime.__all__),
        "json": frozenset(json_mod.__all__),
    }


def _module_of(node: ast.expr, modules: dict[str, str]) -> str | None:
    """The allowed module an expression refers to (`earth`, `earth.show`, ...), if any."""
    if isinstance(node, ast.Name):
        return modules.get(node.id)
    if isinstance(node, ast.Attribute):
        parent = _module_of(node.value, modules)
        return SUBMODULES.get((parent, node.attr)) if parent else None
    return None


def scan_script(script: str) -> ScriptError | None:
    """Returns a `scan` error naming the first problems (with line numbers), or None if clean."""
    lines = script.count("\n") + 1
    if lines > MAX_LINES:
        return ScriptError(
            kind="scan",
            message=f"Script has {lines} lines, max {MAX_LINES}.",
            hint="Shorten the script: fewer steps, no repeated code.",
        )
    try:
        tree = ast.parse(script)
    except SyntaxError as exc:
        return ScriptError(
            kind="scan",
            message=f"Syntax error: {exc.msg}",
            hint=f"Fix the syntax at line {exc.lineno}.",
        )

    allowed = public_names()
    problems: list[tuple[int, str]] = []

    # Names bound to modules by imports → which module (to check `earth.x` early, with a hint).
    modules: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = alias.name if alias.asname else alias.name.split(".")[0]
                if top in allowed:  # disallowed imports are reported below
                    modules[alias.asname or top] = top
        elif isinstance(node, ast.ImportFrom) and node.module in allowed:
            for alias in node.names:
                sub = SUBMODULES.get((node.module, alias.name))
                if sub:
                    modules[alias.asname or alias.name] = sub

    def bad(node: ast.AST, what: str) -> None:
        problems.append((getattr(node, "lineno", 0), what))

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in allowed:
                    bad(node, f"import of '{alias.name}' is not allowed")
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            if node.level:
                bad(node, "relative imports are not allowed")
            elif mod not in allowed:
                bad(node, f"import from '{mod}' is not allowed")
            else:
                for alias in node.names:
                    if alias.name not in allowed[mod]:
                        bad(node, f"'{mod}.{alias.name}' is not available")
        elif isinstance(node, ast.Name):
            if node.id in _BANNED_NAMES or node.id.startswith("__"):
                bad(node, f"use of '{node.id}' is not allowed")
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("_"):
                bad(node, f"private attribute '{node.attr}' is not allowed")
            elif node.attr in _BANNED_ATTRS:
                bad(node, f"attribute '{node.attr}' is not allowed")
            elif (mod := _module_of(node.value, modules)) and node.attr not in allowed[mod]:
                bad(node, f"'{mod}.{node.attr}' is not available")
        elif isinstance(node, ast.ClassDef):
            bad(node, "class definitions are not allowed")
        elif isinstance(node, ast.Global | ast.Nonlocal):
            bad(node, "global/nonlocal are not allowed")

    if not any(isinstance(n, ast.FunctionDef) and n.name == "run" for n in tree.body):
        problems.append((1, "no top-level 'def run(**params)' found"))

    if not problems:
        return None
    problems.sort()
    shown = "; ".join(f"line {ln}: {msg}" for ln, msg in problems[:3])
    more = f" (+{len(problems) - 3} more)" if len(problems) > 3 else ""
    return ScriptError(
        kind="scan",
        message=f"Script rejected before running: {shown}{more}",
        hint=(
            "Only import earth (+ earth.show, earth.presets), math, statistics, datetime, json and "
            "use their public names; no files, network, private (_x) attributes or classes; "
            "define `def run(**params)` that returns a dict."
        ),
    )


# --- Child process ------------------------------------------------------------------------------


def child_env(run_id: str) -> dict[str, str]:
    """Environment built from scratch: no secrets (e.g. ANTHROPIC_API_KEY) reach the script."""
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "PYTHONPATH": str(BACKEND_DIR),
        "RUN_ID": run_id,
    }
    for key in ("HOME", "TMPDIR", "EARTH_IMPL", "EARTH_DATA_DIR"):
        if key in os.environ:
            env[key] = os.environ[key]
    return env


def _kill(proc: asyncio.subprocess.Process) -> None:
    with contextlib.suppress(ProcessLookupError, PermissionError):
        os.killpg(proc.pid, signal.SIGKILL)
    with contextlib.suppress(ProcessLookupError):
        proc.kill()


def _tail(text: str, n: int = 20) -> str:
    return "\n".join(text.rstrip().splitlines()[-n:])


def _shape_error(exc: ValidationError) -> ScriptError:
    parts = [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()[:5]]
    return ScriptError(
        kind="shape",
        message="run() returned the wrong shape: " + "; ".join(parts),
        hint=(
            "Return a dict with findings (dict), evidence (list of dicts), blocks (built with "
            "earth.show.*) and optional notes (list of str)."
        ),
    )


async def run_script(
    script: str,
    params: dict,
    run_id: str,
    on_call: Callable[[EarthCall], Awaitable[None]] | None = None,
    timeout_s: int = 60,
) -> RunOutcome:
    if not RUN_ID_RE.fullmatch(run_id):
        raise ValueError(f"invalid run_id: {run_id!r}")
    calls: list[EarthCall] = []

    def fail(error: ScriptError) -> RunOutcome:
        return RunOutcome(ok=False, result=None, error=error, calls=calls)

    scan = scan_script(script)
    if scan:
        return fail(scan)

    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "app.services.sandbox_child",
        cwd=BACKEND_DIR,
        env=child_env(run_id),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,  # so the whole process group can be killed
        limit=64 * 1024 * 1024,
    )
    job = json.dumps({"script": script, "params": params, "run_id": run_id, "timeout_s": timeout_s})
    assert proc.stdin and proc.stdout and proc.stderr
    try:
        proc.stdin.write(job.encode())
        await proc.stdin.drain()
        proc.stdin.close()
    except (BrokenPipeError, ConnectionResetError):
        pass

    stderr_task = asyncio.create_task(proc.stderr.read())
    final: tuple[str, str] | None = None
    deadline = time.monotonic() + timeout_s
    timed_out = False

    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break
            try:
                raw = await asyncio.wait_for(proc.stdout.readline(), remaining)
            except TimeoutError:
                timed_out = True
                break
            except ValueError:  # a line over the stream limit
                final = (ERROR, json.dumps({"kind": "shape", "message": "Output too large."}))
                break
            if not raw:
                break
            line = raw.decode(errors="replace").rstrip("\n")
            if line.startswith(CALL):
                try:
                    call = EarthCall.model_validate_json(line[len(CALL) :])
                except ValidationError:
                    continue
                calls.append(call)
                if on_call:
                    with contextlib.suppress(Exception):  # a UI hiccup must not kill the run
                        await on_call(call)
            elif line.startswith(RESULT):
                final = (RESULT, line[len(RESULT) :])
            elif line.startswith(ERROR):
                final = (ERROR, line[len(ERROR) :])
            # anything else is stray output: ignored
        if timed_out:
            _kill(proc)
        else:
            try:
                await asyncio.wait_for(proc.wait(), 5)
            except TimeoutError:
                _kill(proc)
    finally:
        _kill(proc)  # no-op if already gone; reaps stragglers in the process group
        await proc.wait()

    stderr = ""
    with contextlib.suppress(Exception):
        stderr = (await asyncio.wait_for(stderr_task, 2)).decode(errors="replace")

    if timed_out:
        return fail(
            ScriptError(
                kind="timeout",
                message=f"Script did not finish within {timeout_s} s and was stopped.",
                hint="Avoid loops over many items; use earth.series()/compare() instead of "
                "many single reads.",
            )
        )

    if final is None:
        code = proc.returncode
        if code == -signal.SIGXCPU:
            return fail(
                ScriptError(
                    kind="timeout", message="Script used up its CPU time.", hint="Do less work."
                )
            )
        return fail(
            ScriptError(
                kind="crash",
                message=f"Script process ended unexpectedly (exit code {code}).",
                traceback_tail=_tail(stderr) or None,
            )
        )

    tag, payload = final
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return fail(ScriptError(kind="shape", message="Result was not valid JSON."))

    if tag == ERROR:
        try:
            return fail(ScriptError.model_validate(data))
        except ValidationError:
            return fail(ScriptError(kind="crash", message=str(data)[:300]))

    try:
        result = ScriptResult.model_validate(data)
    except ValidationError as exc:
        return fail(_shape_error(exc))
    return RunOutcome(ok=True, result=result, error=None, calls=calls)
