"""Threads (BUILD-PLAN A4): conversation history, follow-ups that reuse the earlier run, and
the anti-spam gates (thread size, hourly limits per user and per address).

Offline: EARTH_IMPL=stub and a scripted FakeProvider, as in test_agent_loop.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.routes import threads as threads_routes
from app.core.config import settings
from app.services import threads
from app.services.agent import policy
from app.services.agent.state import AGENT_KEY
from tests.agent_helpers import (
    AREA,
    POND_RUN,
    REGISTER,
    USAGE,
    USER,
    agent_client,
    assert_closed,
    explain,
    finish,
    first,
    names,
    pin,
    sse,
    start,
)
from tests.agent_helpers import (
    get_run as get_run_json,
)


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    with agent_client(tmp_path, monkeypatch, threads_routes.router) as c:
        yield c


def _pond_turns() -> list[Any]:
    """read card → register → measure → finish with a supported cause."""
    from app.services.agent.llm.fake import tool_turn

    return [
        tool_turn(("read_card", {"card_id": "pond_filling"}), usage=USAGE),
        tool_turn(REGISTER, POND_RUN, usage=USAGE),
        tool_turn(
            finish(
                cause_card_id="pond_filling",
                cause="consistent with filling",
                primary_block_id="b1",
                measure_only=False,
            ),
            usage=USAGE,
        ),
    ]


def _first_run(client: TestClient) -> dict[str, Any]:
    pin(_pond_turns())
    evs = start(client, area=AREA)
    assert_closed(evs, "done")
    return first(evs, "run_started")


# --- History: list and reload -------------------------------------------------------------------


def test_list_and_reload_a_conversation(client: TestClient) -> None:
    started = _first_run(client)
    thread_id = started["thread_id"]

    res = client.get("/api/threads", headers={"X-User-Id": USER})
    assert res.status_code == 200, res.text
    [summary] = res.json()
    assert summary["thread_id"] == thread_id
    assert summary["title"] == "Have these ponds been filled in?"
    assert summary["place_name"] == "Test ponds"
    assert summary["last_status"] == "done" and summary["run_count"] == 1
    assert summary["last_sentence"]

    detail = client.get(f"/api/threads/{thread_id}", headers={"X-User-Id": USER})
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert [r["run_id"] for r in body["runs"]] == [started["run_id"]]
    run = body["runs"][0]
    assert run["answer"] is not None and run["events"]
    assert AGENT_KEY not in run["params"] and "agent_loop" not in run["params"]


def test_threads_are_private_and_ids_checked(client: TestClient) -> None:
    thread_id = _first_run(client)["thread_id"]
    other = {"X-User-Id": "someone_else"}
    assert client.get("/api/threads", headers=other).json() == []
    assert client.get(f"/api/threads/{thread_id}", headers=other).status_code == 404
    assert client.get("/api/threads/BAD..ID", headers={"X-User-Id": USER}).status_code == 400
    assert client.get("/api/threads/t_missing", headers={"X-User-Id": USER}).status_code == 404
    assert client.get("/api/threads?limit=0", headers={"X-User-Id": USER}).status_code == 422


# --- Follow-ups reuse the earlier run ------------------------------------------------------------


def test_follow_up_starts_from_the_earlier_answer(client: TestClient) -> None:
    from app.services.agent.llm.fake import tool_turn

    started = _first_run(client)
    # "Since when?": no new data, it quotes the earlier run's date and number directly.
    provider = pin(
        [
            tool_turn(
                finish(
                    title="The change began around March 2026",
                    sentence="The water index was -0.2 by 1 March 2026.",
                    cause_card_id="pond_filling",
                    cause="consistent with filling",
                    measure_only=False,
                    stats=[],
                ),
                usage=USAGE,
            )
        ]
    )
    res = client.post(
        "/api/runs",
        json={"question": "Since when?", "thread_id": started["thread_id"]},
        headers={"X-User-Id": USER},
    )
    assert res.status_code == 200, res.text
    evs = sse(res.text)
    assert_closed(evs, "done")
    assert "answer" in names(evs)
    # No data was read again and no hypotheses had to be registered first.
    assert not [d for n, d in evs if n == "step_started" and d["tool"] in {"run_code", "run_skill"}]

    # The model was shown the earlier answer as a labelled data block.
    first_message = provider.calls[1].messages[0].text  # calls[0] is the guard
    assert '<data name="previous_answer"' in first_message
    assert "pond_filling" in first_message

    # Same place as before, work carried over and traceable.
    run = get_run_json(client, first(evs, "run_started")["run_id"])
    assert run["thread_id"] == started["thread_id"]
    assert run["area"] is not None and run["area"]["name"] == "Test ponds"


def test_follow_up_cannot_invent_numbers(client: TestClient) -> None:
    from app.services.agent.llm.fake import tool_turn

    started = _first_run(client)
    pin(
        [
            tool_turn(finish(sentence="The pond lost 77.7 ha.", stats=[]), usage=USAGE),
            # Corrected: numbers carried from the earlier run's measurements are fine.
            tool_turn(finish(), usage=USAGE),
        ]
    )
    res = client.post(
        "/api/runs",
        json={"question": "How much was lost?", "thread_id": started["thread_id"]},
        headers={"X-User-Id": USER},
    )
    evs = sse(res.text)
    assert_closed(evs, "done")
    assert "77.7" not in first(evs, "answer")["answer"]["sentence"]


def test_carry_keeps_memory_values_and_resets_budgets() -> None:
    from app.services.agent.state import AgentState

    prev = AgentState(provider="fake", model="fake-1", turns=9, code_runs=5)
    prev.hypotheses = ["pond_filling", "seasonal"]
    prev.memory_values = ["Fish farming co-op"]
    prev.findings = {"observed": {"water": {"value": -0.2}}}
    new = AgentState(provider="fake", model="fake-1")
    new.memory_values = ["Another secret"]
    threads.carry(prev, new, "r_prev", ['{"water": -0.2}'])
    assert new.hypotheses == ["pond_filling", "seasonal"]
    assert set(new.memory_values) == {"Fish farming co-op", "Another secret"}
    assert new.turns == 0 and new.code_runs == 0
    assert new.carried_from == "r_prev" and new.carried_results == ['{"water": -0.2}']
    assert new.data_read is False or new.scripts == prev.scripts


# --- Anti-spam ----------------------------------------------------------------------------------


def test_thread_size_cap(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    started = _first_run(client)
    monkeypatch.setattr(threads, "MAX_RUNS_PER_THREAD", 1)
    res = client.post(
        "/api/runs",
        json={"question": "Since when?", "thread_id": started["thread_id"]},
        headers={"X-User-Id": USER},
    )
    assert res.status_code == 409
    assert "start a new one" in res.json()["detail"]


def test_hourly_limit_per_user(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services.agent.llm.fake import tool_turn

    monkeypatch.setattr(settings, "runs_per_hour_per_user", 2)
    monkeypatch.setattr(settings, "runs_per_hour_per_ip", 0)  # off: only the user limit
    pin([tool_turn(explain()), tool_turn(explain())], json_answers=[dict(_GUARD), dict(_GUARD)])
    for _ in range(2):
        start(client, question="What is greenness?")
    res = client.post("/api/runs", json={"question": "Again?"}, headers={"X-User-Id": USER})
    assert res.status_code == 429
    assert int(res.headers["Retry-After"]) >= 1


def test_refused_starts_do_not_use_the_hourly_quota(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.agent.llm.fake import tool_turn

    monkeypatch.setattr(settings, "runs_per_hour_per_user", 1)
    monkeypatch.setattr(settings, "runs_per_hour_per_ip", 1)
    for _ in range(3):  # an unconfigured provider is refused before the quota is charged
        res = client.post(
            "/api/runs",
            json={"question": "Hi", "provider": "claude"},
            headers={"X-User-Id": USER},
        )
        assert res.status_code == 400
    pin([tool_turn(explain())], json_answers=[dict(_GUARD)])
    start(client, question="What is greenness?")  # the one allowed run is still there
    res = client.post("/api/runs", json={"question": "Again?"}, headers={"X-User-Id": USER})
    assert res.status_code == 429


def test_changing_user_header_does_not_escape_the_address_limit(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.agent.llm.fake import tool_turn

    monkeypatch.setattr(settings, "runs_per_hour_per_ip", 2)
    pin([tool_turn(explain()), tool_turn(explain())], json_answers=[dict(_GUARD), dict(_GUARD)])
    start(client, user="alice", question="What is greenness?")
    start(client, user="bob", question="What is greenness?")
    res = client.post("/api/runs", json={"question": "Hi"}, headers={"X-User-Id": "carol"})
    assert res.status_code == 429


def test_client_address_trusts_proxy_headers_only_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = {"x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1, 10.0.0.2"}
    monkeypatch.setattr(settings, "trust_proxy_headers", False)
    assert policy.client_address("10.0.0.5", headers) == "10.0.0.5"
    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    assert policy.client_address("10.0.0.5", headers) == "203.0.113.9"
    # X-Forwarded-For is client-controlled: never used, even when proxy headers are trusted.
    assert policy.client_address("10.0.0.5", {"x-forwarded-for": "198.51.100.1, x"}) == ("10.0.0.5")
    assert policy.client_address(None, {}) == "unknown"


def test_check_rates_refused_by_user_records_nothing_for_the_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "runs_per_hour_per_user", 1)
    monkeypatch.setattr(settings, "runs_per_hour_per_ip", 2)
    policy.reset_rates()
    policy.check_rates("alice", "1.2.3.4")  # alice: 1/1, address: 1/2
    for _ in range(3):  # alice is over her own limit: the address budget must not drain
        with pytest.raises(policy.RateLimited) as exc:
            policy.check_rates("alice", "1.2.3.4")
        assert exc.value.scope == "user"
    policy.check_rates("bob", "1.2.3.4")  # address: 2/2, still had room
    with pytest.raises(policy.RateLimited) as exc:
        policy.check_rates("carol", "1.2.3.4")
    assert exc.value.scope == "address"
    policy.reset_rates()


def test_hit_many_is_all_or_nothing() -> None:
    window = policy.SlidingWindow(clock=lambda: 0.0)
    window.hit("full", 1, 60, "user")
    with pytest.raises(policy.RateLimited):
        window.hit_many([("fresh", 5, 60, "address"), ("full", 1, 60, "user")])
    assert "fresh" not in window._events


def test_refused_hits_are_not_counted() -> None:
    clock = [0.0]
    window = policy.SlidingWindow(clock=lambda: clock[0])
    window.hit("k", 1, 60, "user")
    with pytest.raises(policy.RateLimited):
        window.hit("k", 1, 60, "user")
    clock[0] = 61.0
    window.hit("k", 1, 60, "user")  # the window moved on; the refused hit did not extend it


_GUARD: dict[str, Any] = {"scope": "answerable", "rule_id": None, "reason": "ok"}
_QUESTIONS = [{"key": "use", "label": "What are the ponds used for?", "options": ["Fish", "Birds"]}]


def _paused_run(client: TestClient) -> str:
    """A run waiting on a clarification card; returns its id."""
    from app.services.agent.llm.fake import tool_turn

    pin([tool_turn(REGISTER, POND_RUN, ("ask_user", {"questions": _QUESTIONS}))])
    evs = start(client, area=AREA)
    assert_closed(evs, "waiting_user")
    return first(evs, "run_started")["run_id"]


def _reply(client: TestClient, run_id: str) -> Any:
    return client.post(
        f"/api/runs/{run_id}/reply",
        json={"answers": {"use": "Fish"}},
        headers={"X-User-Id": USER},
    )


# --- Gates on /reply ----------------------------------------------------------------------------


def test_reply_counts_against_the_hourly_limit(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "runs_per_hour_per_user", 1)
    monkeypatch.setattr(settings, "runs_per_hour_per_ip", 0)
    run_id = _paused_run(client)  # the question used the one run this hour
    res = _reply(client, run_id)
    assert res.status_code == 429
    assert int(res.headers["Retry-After"]) >= 1
    assert get_run_json(client, run_id)["status"] == "waiting_user"  # nothing changed


def test_reply_when_the_agent_is_unavailable_is_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.agent import llm

    run_id = _paused_run(client)

    def unavailable(name: str | None = None) -> Any:
        raise llm.ProviderUnavailable("no key")

    monkeypatch.setattr(llm, "get_provider", unavailable)
    res = _reply(client, run_id)
    assert res.status_code == 503
    assert get_run_json(client, run_id)["status"] == "waiting_user"


def test_reply_after_the_spend_cap_is_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_id = _paused_run(client)

    def capped() -> None:
        raise policy.SpendCapReached(spent_usd=20.5, cap_usd=20.0)

    monkeypatch.setattr(policy, "check_spend_cap", capped)
    res = _reply(client, run_id)
    assert res.status_code == 503
    assert get_run_json(client, run_id)["status"] == "waiting_user"


# --- Follow-ups skip runs that did not finish ---------------------------------------------------


def test_follow_up_skips_failed_and_unanswered_runs(client: TestClient) -> None:
    from app.services import runs as run_store

    started = _first_run(client)
    done = run_store.list_runs(started["thread_id"])[-1]
    failed = done.model_copy(update={"run_id": "r_failed", "status": "failed", "answer": None})
    paused = done.model_copy(update={"run_id": "r_paused", "status": "waiting_user"})

    found = threads.previous_agent_run([done, failed, paused])
    assert found is not None and found[0].run_id == done.run_id
    assert threads.previous_agent_run([failed, paused]) is None
    preset = done.model_copy(update={"params": {}})  # done, but no agent state
    assert threads.previous_agent_run([preset]) is None


# --- In-memory limits stay bounded --------------------------------------------------------------


def test_rate_windows_drop_idle_keys_when_large() -> None:
    clock = [0.0]
    window = policy.SlidingWindow(clock=lambda: clock[0])
    window._PRUNE_AT = 2
    window.hit("a", 5, 60, "user")
    window.hit("b", 5, 60, "user")
    clock[0] = 61.0  # a and b are now outside the window
    window.hit("c", 5, 60, "user")
    assert set(window._events) == {"c"}


def test_cooldowns_drop_old_users_when_large() -> None:
    clock = [0.0]
    cooldowns = policy.Cooldowns(clock=lambda: clock[0])
    cooldowns._PRUNE_AT = 2
    cooldowns.check("a", cooldown_s=3)
    cooldowns.check("b", cooldown_s=3)
    clock[0] = 10.0
    cooldowns.check("c", cooldown_s=3)
    assert set(cooldowns._last) == {"c"}
