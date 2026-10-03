"""Earth service (HANDOFF B2.1): the trusted side of the Docker sandbox (SANDBOX_IMPL=docker).

A sandbox container has no internet and no keys. Its `earth` module (`earth/client.py`) POSTs
each public call here: `POST /call/{fn}` with `Authorization: Bearer <run token>` and
`{"kwargs": {...}}`. This service runs the real `earth` function for that run and answers
`{"ok": <result json>}` or `{"error": {kind, message, hint}}`.

- Allow-list: the traced functions among `public_names()["earth"]`; classes (`Area`, ...) and
  `earth.show` are built inside the container.
- Per run: a random token (one session per `run_script`), the call budget, the call log
  (`EarthCall`s go straight to the runner's `on_call`, never through the untrusted container)
  and the layer ids it was handed (other runs' layers are refused, and freed at the end).
- Areas are re-measured from their GeoJSON, so a forged `area_ha` cannot dodge the size limits.
- Served by its own uvicorn server on EARTH_SERVICE_HOST:EARTH_SERVICE_PORT (a thread in the
  backend process), separate from the public API. In compose it is reachable only on the
  internal `earth-only` network (the port is never published).

Limitation: `earth.calls` keeps the run id / budget / listener in module globals, so calls are
serialised by `_EARTH_LOCK` (one earth call at a time across docker runs).
"""

from __future__ import annotations

import asyncio
import contextlib
import functools
import importlib
import inspect
import secrets
import threading
import typing
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError
from pydantic_core import to_jsonable_python

import earth
from earth import calls as earth_calls
from earth import settings as earth_settings
from earth.types import Area, EarthCall, LayerRef

MAX_BODY_BYTES = 2 * 1024 * 1024


@functools.cache
def allowed_functions() -> frozenset[str]:
    """Public earth functions a container may call: the traced ones (they log and budget)."""
    from app.services.sandbox import public_names

    return frozenset(
        n
        for n in public_names()["earth"]
        if inspect.isfunction(getattr(earth, n, None)) and hasattr(getattr(earth, n), "__wrapped__")
    )


@dataclass
class Session:
    run_id: str
    token: str
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue[EarthCall]
    count: int = 0
    calls: list[EarthCall] = field(default_factory=list)
    layer_ids: set[str] = field(default_factory=set)

    def emit(self, call: EarthCall) -> None:
        self.calls.append(call)
        with contextlib.suppress(RuntimeError):  # loop closed: the run is over
            self.loop.call_soon_threadsafe(self.queue.put_nowait, call)


_sessions: dict[str, Session] = {}
_sessions_lock = threading.Lock()
_EARTH_LOCK = threading.Lock()


def open_session(run_id: str) -> Session:
    """Called by the runner (in its event loop) before the container starts."""
    s = Session(
        run_id=run_id,
        token=secrets.token_urlsafe(32),
        loop=asyncio.get_running_loop(),
        queue=asyncio.Queue(),
    )
    with _sessions_lock:
        _sessions[s.token] = s
    return s


def close_session(s: Session) -> None:
    """Revokes the token and frees the run's layers (the backend process outlives runs)."""
    with _sessions_lock:
        _sessions.pop(s.token, None)
    impl = importlib.import_module(
        "earth._stub" if earth_settings.impl() == "stub" else "earth.real"
    )
    store = getattr(impl, "_layers", {})
    for lid in s.layer_ids:
        store.pop(lid, None)


def _session(authorization: str | None) -> Session | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[len("Bearer ") :]
    with _sessions_lock:
        for known, s in _sessions.items():
            if secrets.compare_digest(known, token):
                return s
    return None


def _error(kind: str, message: str, hint: str | None = None) -> dict:
    return {"error": {"kind": kind, "message": message, "hint": hint}}


def _coerce(fn_name: str, kwargs: dict, s: Session) -> dict:
    """JSON kwargs → the real function's argument types. Raises TypeError / EarthError."""
    real = getattr(earth, fn_name)
    bound = inspect.signature(real.__wrapped__).bind(**kwargs)
    hints = typing.get_type_hints(real.__wrapped__)
    out: dict[str, Any] = {}
    for name, value in bound.arguments.items():
        hint = hints.get(name)
        if isinstance(hint, type) and issubclass(hint, BaseModel):
            try:
                value = hint.model_validate(value)
            except ValidationError as exc:
                raise earth.EarthError(
                    f"{name} is not a valid {hint.__name__}.",
                    f"Pass the {hint.__name__} you got from earth.",
                ) from exc
            if isinstance(value, Area):  # re-measure: never trust area_ha from the container
                value = Area.from_geojson(value.geojson, name=value.name)
            if isinstance(value, LayerRef) and value.id not in s.layer_ids:
                raise earth.EarthError(
                    f"Unknown layer {value.id!r}.", "Pass a LayerRef returned by load()/index()."
                )
        out[name] = value
    return out


def call(s: Session, fn_name: str, kwargs: dict) -> dict:
    """Runs one earth call for a session. Sync: runs in a worker thread."""
    try:
        args = _coerce(fn_name, kwargs, s)
    except TypeError as exc:
        return _error("type_error", f"{fn_name}(): {exc}")
    except earth.EarthError as exc:
        return {"error": exc.to_dict()}

    with _EARTH_LOCK:
        saved = (earth_calls._run_id, earth_calls._count, earth_calls._listener)
        earth_calls._run_id, earth_calls._count = s.run_id, s.count
        earth_calls._listener = s.emit
        try:
            result = getattr(earth, fn_name)(**args)
        except earth.EarthError as exc:
            return {"error": exc.to_dict()}
        except Exception as exc:  # noqa: BLE001 — becomes a crash in the script, like in-process
            return _error("internal", f"{type(exc).__name__}: {exc}")
        finally:
            s.count = earth_calls._count
            earth_calls._run_id, earth_calls._count, earth_calls._listener = saved

    if isinstance(result, LayerRef):
        s.layer_ids.add(result.id)
    return {"ok": to_jsonable_python(result)}


app = FastAPI(title="earth service (internal)", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/call/{fn_name}")
async def call_route(
    fn_name: str, request: Request, authorization: str | None = Header(None)
) -> JSONResponse:
    s = _session(authorization)
    if s is None:
        return JSONResponse({"detail": "unknown run token"}, status_code=401)
    if fn_name not in allowed_functions():
        return JSONResponse(_error("not_allowed", f"earth.{fn_name} is not available"), 404)
    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        return JSONResponse(_error("too_large", "Request too large."), 413)
    try:
        payload = await request.json()
        kwargs = payload["kwargs"]
        assert isinstance(kwargs, dict)
    except Exception:  # noqa: BLE001
        return JSONResponse(_error("bad_request", "Expected {'kwargs': {...}}."), 400)
    from starlette.concurrency import run_in_threadpool

    return JSONResponse(await run_in_threadpool(call, s, fn_name, kwargs))


# --- server (a thread with its own event loop) --------------------------------------------------

_server_lock = threading.Lock()
_server: Any = None


def ensure_started(host: str, port: int, timeout_s: float = 10) -> None:
    """Starts the earth service once per process. Idempotent; blocks until it is listening."""
    global _server
    import time

    import uvicorn

    with _server_lock:
        if _server is not None and _server.started:
            return
        server = uvicorn.Server(
            uvicorn.Config(app, host=host, port=port, log_level="warning", lifespan="off")
        )
        server.install_signal_handlers = lambda: None  # type: ignore[method-assign]
        thread = threading.Thread(target=server.run, name="earth-service", daemon=True)
        thread.start()
        deadline = time.monotonic() + timeout_s
        while not server.started:
            if not thread.is_alive() or time.monotonic() > deadline:
                raise RuntimeError(f"earth service did not start on {host}:{port}")
            time.sleep(0.02)
        _server = server
