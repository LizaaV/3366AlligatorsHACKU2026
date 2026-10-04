"""Shared helpers for the agent tests that go through the HTTP API (A3 loop, A4 threads).

Offline: EARTH_IMPL=stub and a scripted FakeProvider pinned with `set_provider_override`.
Test modules import from here, never from each other, so renaming a test file or a helper
inside one cannot break another.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient

from app.api.routes import runs
from app.core.config import settings
from app.schemas.answer import Answer
from app.services.agent import llm, policy
from app.services.agent.llm.base import Message, Usage
from app.services.agent.llm.fake import FakeProvider
from earth.presets import HOO_HOK_WAI

USER = "u_loop"
PLACE = "p_ponds"
REMEMBERED = "Fish farming co-op"
GUARD_OK: dict[str, Any] = {
    "scope": "answerable",
    "rule_id": None,
    "reason": "A question about change at a place.",
}
AREA: dict[str, Any] = {"geojson": HOO_HOK_WAI.geojson, "name": "Test ponds"}
USAGE = Usage(input_tokens=100, output_tokens=50, cache_read_tokens=10)
#: Earth functions whose steps read satellite data (the grounding `describe` is context).
DATA_TOOLS = {"scenes", "load", "index", "measure", "series", "compare", "surroundings"}

POND_SCRIPT = """
import earth


def run(**params):
    area = earth.Area.from_geojson(params["area"], name=params.get("name"))
    earth.describe(area)
    earth.scenes(area)
    observed = {
        "water": {"value": -0.2, "before": 0.3, "after": -0.2, "delta": -0.5,
                  "inside_band": False, "local": True, "persistent": True, "sudden": True,
                  "date": "2026-03-01"},
        "roughness": {"value": -12.0, "before": -20.0, "after": -12.0, "delta": 8.0,
                      "inside_band": False, "local": True, "persistent": True,
                      "sudden": None, "date": None},
        "moisture": {"value": -0.2, "before": 0.1, "after": -0.2, "delta": -0.3,
                     "inside_band": False, "local": True, "persistent": None,
                     "sudden": None, "date": None},
        "bare": {"value": 0.1, "before": 0.06, "after": 0.1, "delta": 0.04,
                 "inside_band": False, "local": True, "persistent": None,
                 "sudden": None, "date": None},
        "greenness": {"value": 0.1, "before": 0.12, "after": 0.1, "delta": -0.02,
                      "inside_band": True, "local": True, "persistent": None,
                      "sudden": None, "date": None},
    }
    blocks = [earth.show.stat("Water index change", -0.5, "index", primary=True, id="b1")]
    return {"findings": {"observed": observed}, "evidence": [], "blocks": blocks,
            "notes": ["Optical only."]}
"""

VALUE_SCRIPT = """
import earth


def run(**params):
    value = params["value"]
    earth.scenes(earth.Area.from_geojson(params["area"]))
    observed = {"water": {"value": value, "before": None, "after": None, "delta": None,
                          "inside_band": None, "local": None, "persistent": None,
                          "sudden": None, "date": None}}
    blocks = [earth.show.stat("Water index", value, "index", id="b1")]
    return {"findings": {"observed": observed}, "evidence": [], "blocks": blocks, "notes": []}
"""


@contextmanager
def agent_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *routers: APIRouter
) -> Iterator[TestClient]:
    """A TestClient over the runs router (plus `routers`), with stub earth data, a temporary
    run store, no cooldown, agent mode and a spend cap that never trips."""
    monkeypatch.setenv("EARTH_IMPL", "stub")
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("RUNS_DB_PATH", str(tmp_path / "runs.sqlite"))
    monkeypatch.setattr(settings, "run_cooldown_s", 0.0)
    monkeypatch.setattr(settings, "agent_mode", "agent")
    monkeypatch.setattr(settings, "daily_spend_cap_usd", 20.0)
    policy.reset_cooldowns()
    app = FastAPI()
    for router in (runs.router, *routers):
        app.include_router(router, prefix="/api")
    with TestClient(app) as c:
        yield c
    policy.reset_cooldowns()


def pin(turns: list[Any], json_answers: list[Any] | None = None) -> FakeProvider:
    provider = FakeProvider(turns=turns, json=[GUARD_OK] if json_answers is None else json_answers)
    llm.set_provider_override(provider)
    return provider


def sse(text: str) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for chunk in text.replace("\r\n", "\n").split("\n\n"):
        name, data = None, []
        for line in chunk.split("\n"):
            if line.startswith("event:"):
                name = line[6:].strip()
            elif line.startswith("data:"):
                data.append(line[5:].strip())
        if name:
            out.append((name, json.loads("\n".join(data))))
    return out


def start(client: TestClient, user: str = USER, **body: Any) -> list[tuple[str, dict[str, Any]]]:
    payload = {"question": "Have these ponds been filled in?", **body}
    res = client.post("/api/runs", json=payload, headers={"X-User-Id": user})
    assert res.status_code == 200, res.text
    return sse(res.text)


def names(evs: list[tuple[str, dict[str, Any]]]) -> list[str]:
    return [n for n, _ in evs]


def first(evs: list[tuple[str, dict[str, Any]]], name: str) -> dict[str, Any]:
    return next(d for n, d in evs if n == name)


def answer_of(evs: list[tuple[str, dict[str, Any]]]) -> Answer:
    return Answer.model_validate(first(evs, "answer")["answer"])


def assert_closed(evs: list[tuple[str, dict[str, Any]]], status: str) -> dict[str, Any]:
    ns = names(evs)
    assert ns[-1] == "done" and ns.count("done") == 1, ns
    done = evs[-1][1]
    assert done["status"] == status, done
    return done


def assert_steps(evs: list[tuple[str, dict[str, Any]]], after: int = 0) -> list[int]:
    """Steps start and finish in pairs with strictly increasing indexes (> `after`)."""
    started = [d["index"] for n, d in evs if n == "step_started"]
    finished = [d["index"] for n, d in evs if n == "step_finished"]
    assert started == sorted(set(started)), started
    assert sorted(finished) == started
    assert all(i > after for i in started)
    return started


def get_run(client: TestClient, run_id: str, user: str = USER) -> dict[str, Any]:
    res = client.get(f"/api/runs/{run_id}", headers={"X-User-Id": user})
    assert res.status_code == 200, res.text
    return res.json()


def finish(**kw: Any) -> tuple[str, dict[str, Any]]:
    args: dict[str, Any] = {
        "title": "The pond no longer shows open water",
        "sentence": "The water index fell from 0.3 to -0.2 inside the outline.",
        "cause_card_id": None,
        "cause": None,
        "todo": "Check the next clear image after heavy rain.",
        "stats": [{"label": "Water index change", "value": "-0.5"}],
        "caveats": ["Satellite images cannot show why the pond changed."],
        "primary_block_id": None,
        "followups": ["Since when?"],
        "measure_only": True,
    }
    args.update(kw)
    return ("finish", args)


def explain(**kw: Any) -> tuple[str, dict[str, Any]]:
    """A finish for an explanation-only answer (no data, no numbers)."""
    base: dict[str, Any] = {
        "title": "Greenness is living plant cover",
        "sentence": "Greenness measures how much living plant cover the satellite sees.",
        "todo": None,
        "stats": [],
        "caveats": [],
        "followups": [],
        "measure_only": False,
    }
    return finish(**{**base, **kw})


REGISTER = ("register_hypotheses", {"hypotheses": ["pond_filling"], "expectation_table": []})
POND_RUN = ("run_code", {"script": POND_SCRIPT, "params_json": "{}"})


def results_of(message: Message) -> list[dict[str, Any]]:
    return [
        {"id": r.call_id, "error": r.is_error, **json.loads(r.content)}
        for r in message.tool_results
    ]
