"""Child-process entrypoint of the sandbox runner. Run as `python -m app.services.sandbox_child`.

Protocol: stdin = one JSON object {script, params, run_id, timeout_s}. stdout carries only
prefixed lines: `@@EARTH_CALL <json>` per earth call, then one `@@RESULT <json>` or
`@@ERROR <json>`. The script's own prints are redirected to stderr, so they cannot break parsing.
"""

from __future__ import annotations

import builtins
import importlib
import json
import math
import sys
import traceback
from datetime import date, datetime
from types import SimpleNamespace
from typing import Any

CALL = "@@EARTH_CALL "
RESULT = "@@RESULT "
ERROR = "@@ERROR "


def _default(obj: Any) -> Any:
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    if isinstance(obj, date | datetime):
        return obj.isoformat()
    if isinstance(obj, set | frozenset | tuple):
        return list(obj)
    if hasattr(obj, "tolist"):  # numpy arrays and scalars
        return obj.tolist()
    raise TypeError(f"{type(obj).__name__} is not JSON-serialisable")


def _clean_floats(obj: Any) -> Any:
    """NaN/inf are not valid JSON (the frontend's JSON.parse rejects them) → None."""
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    if isinstance(obj, dict):
        return {k: _clean_floats(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean_floats(v) for v in obj]
    return obj


def _limit_resources(timeout_s: int) -> None:
    try:
        import resource

        limit = int(timeout_s) + 2
        resource.setrlimit(resource.RLIMIT_CPU, (limit, limit + 1))
        if sys.platform == "linux":  # RLIMIT_AS is unreliable on macOS
            resource.setrlimit(resource.RLIMIT_AS, (2 * 1024**3, 2 * 1024**3))
    except Exception:  # noqa: BLE001 — best effort, unsupported on some platforms
        pass


def _proxies() -> dict[str, SimpleNamespace]:
    """Module name → a namespace holding only the public names (no module internals)."""
    from app.services.sandbox import SUBMODULES, public_names

    allowed = public_names()
    out: dict[str, SimpleNamespace] = {}
    for mod in sorted(allowed, key=lambda m: m.count(".")):
        real = importlib.import_module(mod)
        out[mod] = SimpleNamespace(**{n: getattr(real, n) for n in allowed[mod]})
    for (parent, attr), child in SUBMODULES.items():
        setattr(out[parent], attr, out[child])
    return out


_BLOCKED_BUILTINS = {
    "open",
    "eval",
    "exec",
    "compile",
    "input",
    "breakpoint",
    "globals",
    "locals",
    "vars",
    "getattr",
    "setattr",
    "delattr",
    "help",
    "exit",
    "quit",
    "memoryview",
    "type",
    "object",
    "super",
    "__build_class__",
    "__loader__",
    "__spec__",
}


def _safe_builtins(proxies: dict[str, SimpleNamespace]) -> dict[str, Any]:
    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):  # noqa: A002
        if level or name not in proxies:
            raise ImportError(f"import of '{name}' is not allowed")
        if fromlist:
            return proxies[name]
        return proxies[name.split(".")[0]]  # `import earth.presets` binds `earth`

    safe = {k: v for k, v in vars(builtins).items() if k not in _BLOCKED_BUILTINS}
    safe["__import__"] = guarded_import
    return safe


def _tail(text: str, n: int = 20) -> str:
    return "\n".join(text.rstrip().splitlines()[-n:])


def main() -> None:
    out = sys.stdout
    sys.stdout = sys.stderr  # the script's print() must not touch the protocol stream

    def emit(prefix: str, payload: dict) -> None:
        out.write(prefix + json.dumps(payload, default=_default) + "\n")
        out.flush()

    try:
        job = json.loads(sys.stdin.read())
        _limit_resources(job.get("timeout_s", 60))
        import earth

        earth.set_run(job["run_id"])
        earth.set_listener(lambda call: emit(CALL, call.model_dump(mode="json")))
        namespace: dict[str, Any] = {
            "__name__": "__sandbox__",
            "__builtins__": _safe_builtins(_proxies()),
        }
        exec(compile(job["script"], "<script>", "exec"), namespace)  # noqa: S102
        result = namespace["run"](**job["params"])
        if not isinstance(result, dict):
            emit(
                ERROR,
                {
                    "kind": "shape",
                    "message": f"run() returned {type(result).__name__}, expected a dict.",
                    "hint": "Return {'findings': {}, 'evidence': [], 'blocks': [], 'notes': []}.",
                },
            )
            return
        emit(RESULT, _clean_floats(json.loads(json.dumps(result, default=_default))))
    except BaseException as exc:  # noqa: BLE001 — everything becomes an @@ERROR line
        import earth

        tb = _tail(traceback.format_exc())
        if isinstance(exc, earth.EarthError):
            kind = "budget" if isinstance(exc, earth.BudgetExceeded) else "crash"
            payload = {
                "kind": kind,
                "message": str(exc.message),
                "hint": exc.hint,
                "earth_kind": exc.kind,
            }
        else:
            payload = {"kind": "crash", "message": f"{type(exc).__name__}: {exc}", "hint": None}
        payload["traceback_tail"] = tb
        emit(ERROR, payload)


if __name__ == "__main__":
    main()
