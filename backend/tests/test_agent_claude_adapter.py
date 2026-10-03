"""A3 Claude adapter (`llm/claude.py`): request shape, response mapping, raw replay,
fallbacks, refusals, errors and cost. Offline: the real SDK client talks to an httpx2
`MockTransport`, so the exact JSON body and headers it would send are asserted, and the
responses are parsed by the SDK's own types. Never calls the real API."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import anthropic
import httpx2
import pytest
from anthropic.types import Message as SdkMessage
from anthropic.types.beta import BetaMessage
from pydantic import SecretStr

from app.core.config import settings
from app.services.agent.llm import (
    LLMError,
    LLMProvider,
    Message,
    ToolCall,
    ToolResult,
    ToolSpec,
    Usage,
    available_providers,
    get_provider,
)
from app.services.agent.llm import claude as claude_mod
from app.services.agent.llm.claude import (
    CLAUDE_PRICING,
    FALLBACK_BETA,
    MAX_RETRIES,
    ClaudeProvider,
)

FAKE_KEY = "sk-ant-test-not-a-real-key-0000"
MODEL = "claude-opus-5-5"
SYSTEM = ["You are the Earth Agent harness rules.", "Card index: seasonal, pond-filling."]
SECRET_TEXT = "the user's private question about plot 42"

READ_CARD = ToolSpec(
    name="read_card",
    description="Read a knowledge card. Call this before using a card's signs.",
    input_schema={
        "type": "object",
        "properties": {"card_id": {"type": "string"}},
        "required": ["card_id"],
        "additionalProperties": False,
    },
)
ASK_USER = ToolSpec(
    name="ask_user",
    description="Ask the user up to 3 questions.",
    input_schema={
        "type": "object",
        "properties": {
            "questions": {
                "type": "array",
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "properties": {"key": {"type": "string"}, "label": {"type": "string"}},
                    "required": ["key", "label"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["questions"],
        "additionalProperties": False,
    },
)

#: An assistant turn as Claude returns it: thinking (omitted text + signature), text, tool_use.
RAW_TURN = [
    {"type": "thinking", "thinking": "", "signature": "EqQBCkYIBxgCKkBsig=="},
    {"type": "text", "text": "Reading the seasonal card first.", "citations": None},
    {"type": "tool_use", "id": "toolu_01A", "name": "read_card", "input": {"card_id": "seasonal"}},
    {"type": "tool_use", "id": "toolu_01B", "name": "read_card", "input": {"card_id": "pond"}},
]


# --- Fake Anthropic API ------------------------------------------------------------------------


@dataclass
class Sent:
    """One request the SDK sent."""

    url: str
    headers: httpx2.Headers
    body: dict[str, Any]


Reply = httpx2.Response | Callable[[httpx2.Request], httpx2.Response]


class FakeAPI:
    """httpx2 MockTransport handler: records each request, answers from a queue."""

    def __init__(self, *replies: Reply) -> None:
        self.replies = list(replies)
        self.sent: list[Sent] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.sent.append(Sent(str(request.url), request.headers, json.loads(request.content)))
        if not self.replies:
            raise AssertionError("unexpected extra API call")
        reply = self.replies.pop(0)
        return reply(request) if callable(reply) else reply

    @property
    def last(self) -> Sent:
        return self.sent[-1]


def message_json(
    content: list[dict[str, Any]],
    *,
    stop: str = "end_turn",
    usage: dict[str, Any] | None = None,
    stop_details: dict[str, Any] | None = None,
    model: str = MODEL,
) -> dict[str, Any]:
    """A Messages API response body, checked against the SDK's own response types."""
    body = {
        "id": "msg_01test",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop,
        "stop_sequence": None,
        "stop_details": stop_details,
        "usage": {
            "input_tokens": 1200,
            "output_tokens": 300,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
            **(usage or {}),
        },
    }
    BetaMessage.model_validate(body)  # realistic: the SDK's own response types accept it
    if not any(block["type"] == "fallback" for block in content):  # beta-only block type
        SdkMessage.model_validate({**body, "usage": {**body["usage"], "iterations": None}})
    return body


def ok(content: list[dict[str, Any]], **kw: Any) -> httpx2.Response:
    return httpx2.Response(200, json=message_json(content, **kw), headers={"request-id": "req_1"})


def api_error(status: int, err_type: str, message: str, *, retry: bool = False) -> httpx2.Response:
    headers = {"request-id": "req_err"}
    headers.update({"retry-after-ms": "1"} if retry else {"x-should-retry": "false"})
    return httpx2.Response(
        status,
        json={"type": "error", "error": {"type": err_type, "message": message}},
        headers=headers,
    )


def provider(api: FakeAPI, *, fallbacks: bool = True) -> ClaudeProvider:
    transport = httpx2.MockTransport(api)
    return ClaudeProvider(
        api_key=FAKE_KEY,
        model=MODEL,
        fallbacks=fallbacks,
        http_client=anthropic.DefaultAsyncHttpxClient(transport=transport),
    )


def complete(p: ClaudeProvider, messages: list[Message], **kw: Any):
    args: dict[str, Any] = {
        "system": SYSTEM,
        "messages": messages,
        "tools": [READ_CARD],
        "max_tokens": 16000,
        "effort": "medium",
        **kw,
    }
    return asyncio.run(p.complete(**args))


def complete_json(p: ClaudeProvider, **kw: Any):
    args: dict[str, Any] = {
        "system": ["You are the guard."],
        "user": "Is this question answerable from satellite data?",
        "schema": {
            "type": "object",
            "properties": {"scope": {"type": "string", "enum": ["answerable", "refuse"]}},
            "required": ["scope"],
            "additionalProperties": False,
        },
        "max_tokens": 4000,
        "effort": "low",
        **kw,
    }
    return asyncio.run(p.complete_json(**args))


USER = Message(role="user", text="Was the pond at this place filled in?")


@pytest.fixture(autouse=True)
def _fresh_fallback_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test starts as a fresh process: server-side fallbacks not yet rejected."""
    monkeypatch.setattr(claude_mod, "_fallbacks_rejected", False)


# --- Construction ------------------------------------------------------------------------------


def test_provider_is_an_llm_provider_with_sdk_settings() -> None:
    p = provider(FakeAPI())
    assert isinstance(p, LLMProvider)
    assert (p.name, p.model, p.fallbacks) == ("claude", MODEL, True)
    assert p._client.max_retries == MAX_RETRIES == 1
    assert p._client.timeout.read == claude_mod.DEFAULT_TIMEOUT_S
    assert FAKE_KEY not in repr(p)


def test_get_provider_builds_claude_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "anthropic_api_key", SecretStr(FAKE_KEY))
    monkeypatch.setattr(settings, "llm_fallbacks", False)
    p = get_provider("claude")  # no network: building the client sends nothing
    assert isinstance(p, ClaudeProvider)
    assert (p.model, p.fallbacks) == (settings.claude_model, False)
    assert "claude" in available_providers()


# --- complete(): request shape -----------------------------------------------------------------


def test_complete_request_shape() -> None:
    api = FakeAPI(ok([{"type": "text", "text": "Done."}]))
    complete(provider(api), [USER], tools=[READ_CARD, ASK_USER], effort="high")

    sent = api.last
    assert sent.url.endswith("/v1/messages?beta=true")
    assert sent.headers["anthropic-beta"] == FALLBACK_BETA
    assert sent.headers["x-api-key"] == FAKE_KEY  # the key only travels in its header
    body = sent.body
    assert body["model"] == "claude-opus-5-5"
    assert body["max_tokens"] == 16000
    assert body["fallbacks"] == "default"
    assert body["thinking"] == {"type": "adaptive"}  # always on; no budget_tokens
    assert body["output_config"] == {"effort": "high"}
    assert body["tool_choice"] == {"type": "auto"}  # forcing a tool is a 400 on Opus 5.5
    assert body["cache_control"] == {"type": "ephemeral"}  # automatic caching of the tail
    for banned in ("temperature", "top_p", "top_k", "budget_tokens", "stop_sequences"):
        assert banned not in body
    # Stable system parts, one breakpoint on the last part (caches tools + system together).
    assert body["system"] == [
        {"type": "text", "text": SYSTEM[0]},
        {"type": "text", "text": SYSTEM[1], "cache_control": {"type": "ephemeral"}},
    ]
    # Strict tools, in the harness's order, no breakpoint (the system one covers them).
    assert [t["name"] for t in body["tools"]] == ["read_card", "ask_user"]
    assert all(t["strict"] is True and "cache_control" not in t for t in body["tools"])
    assert body["tools"][0] == {
        "name": "read_card",
        "description": READ_CARD.description,
        "input_schema": READ_CARD.input_schema,
        "strict": True,
    }
    # maxItems is not supported in strict mode: moved into the description by the SDK helper.
    questions = body["tools"][1]["input_schema"]["properties"]["questions"]
    assert "maxItems" not in questions and "maxItems: 3" in questions["description"]
    assert body["messages"] == [
        {"role": "user", "content": [{"type": "text", "text": USER.text}]},
    ]


def test_no_system_puts_the_breakpoint_on_the_last_tool() -> None:
    api = FakeAPI(ok([{"type": "text", "text": "Done."}]))
    complete(provider(api), [USER], system=["", "   "], tools=[READ_CARD, ASK_USER])
    body = api.last.body
    assert "system" not in body
    assert "cache_control" not in body["tools"][0]
    assert body["tools"][1]["cache_control"] == {"type": "ephemeral"}


def test_no_tools_sends_no_tool_choice() -> None:
    api = FakeAPI(ok([{"type": "text", "text": "Done."}]))
    complete(provider(api), [USER], tools=[])
    assert "tools" not in api.last.body and "tool_choice" not in api.last.body


def test_fallbacks_off_uses_the_plain_endpoint() -> None:
    api = FakeAPI(ok([{"type": "text", "text": "Done."}]))
    complete(provider(api, fallbacks=False), [USER])
    assert api.last.url.endswith("/v1/messages")
    assert "anthropic-beta" not in api.last.headers
    assert "fallbacks" not in api.last.body


# --- complete(): response mapping --------------------------------------------------------------


def test_tool_turn_is_mapped_and_raw_kept_unchanged() -> None:
    usage = {
        "input_tokens": 50,
        "output_tokens": 400,
        "cache_read_input_tokens": 6000,
        "cache_creation_input_tokens": 700,
    }
    api = FakeAPI(ok(RAW_TURN, stop="tool_use", usage=usage))
    p = provider(api)
    turn = complete(p, [USER])

    assert turn.stop == "tool_use"
    assert turn.text == "Reading the seasonal card first."
    assert turn.tool_calls == [
        ToolCall(id="toolu_01A", name="read_card", args={"card_id": "seasonal"}),
        ToolCall(id="toolu_01B", name="read_card", args={"card_id": "pond"}),
    ]
    assert turn.raw == RAW_TURN  # every block, as the API sent it (thinking + signature)
    json.dumps(turn.raw)  # JSON-serialisable, storable in RunRecord.params
    assert turn.usage == Usage(
        input_tokens=50, output_tokens=400, cache_read_tokens=6000, cache_write_tokens=700
    )
    assert turn.refusal_category is None
    expected = (50 * 4.00 + 400 * 20.00 + 6000 * 0.20 + 700 * 5.00) / 1_000_000
    assert p.cost_usd(turn.usage) == pytest.approx(expected)
    assert CLAUDE_PRICING.cost_usd(Usage(output_tokens=1_000_000)) == pytest.approx(20.0)


@pytest.mark.parametrize(
    ("api_stop", "content", "expected"),
    [
        ("end_turn", [{"type": "text", "text": "All done."}], "end"),
        ("stop_sequence", [{"type": "text", "text": "All done."}], "end"),
        ("max_tokens", [{"type": "text", "text": "Cut o"}], "max_tokens"),
        ("model_context_window_exceeded", [{"type": "text", "text": "x"}], "max_tokens"),
        ("tool_use", [{"type": "text", "text": "no call came"}], "end"),
    ],
)
def test_stop_reasons(api_stop: str, content: list[dict[str, Any]], expected: str) -> None:
    turn = complete(provider(FakeAPI(ok(content, stop=api_stop))), [USER])
    assert turn.stop == expected


def test_max_tokens_keeps_parsed_calls_for_the_harness() -> None:
    content = [{"type": "tool_use", "id": "toolu_cut", "name": "read_card", "input": {}}]
    turn = complete(provider(FakeAPI(ok(content, stop="max_tokens"))), [USER])
    assert turn.stop == "max_tokens"
    assert [c.id for c in turn.tool_calls] == ["toolu_cut"]


def test_refusal_is_mapped_and_drops_tool_calls() -> None:
    content = [
        {"type": "text", "text": "Let me look"},
        {"type": "tool_use", "id": "toolu_partial", "name": "read_card", "input": {}},
    ]
    details = {"type": "refusal", "category": "cyber", "explanation": "Declined."}
    turn = complete(provider(FakeAPI(ok(content, stop="refusal", stop_details=details))), [USER])
    assert turn.stop == "refusal"
    assert turn.refusal_category == "cyber"
    assert turn.tool_calls == []  # a refusal can cut a call off mid-input: never run it
    assert turn.raw == content


def test_refusal_before_any_output_without_category() -> None:
    turn = complete(provider(FakeAPI(ok([], stop="refusal", stop_details=None))), [USER])
    assert (turn.stop, turn.text, turn.tool_calls, turn.raw) == ("refusal", "", [], [])
    assert turn.refusal_category is None


# --- Transcript translation --------------------------------------------------------------------


def test_raw_blocks_replayed_unchanged_and_results_batched() -> None:
    api = FakeAPI(ok(RAW_TURN, stop="tool_use"), ok([{"type": "text", "text": "Done."}]))
    p = provider(api)
    first = complete(p, [USER])
    transcript = [
        USER,
        first.to_message(p.name),
        Message(
            role="user",
            tool_results=[
                ToolResult(call_id="toolu_01A", content='{"card": "seasonal"}'),
                ToolResult(call_id="toolu_01B", content='{"error": "unknown card"}', is_error=True),
            ],
        ),
    ]
    # Round trip through JSON, as the run store does between turns.
    stored = [Message.model_validate_json(m.model_dump_json()) for m in transcript]
    complete(p, stored)

    messages = api.last.body["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user"]
    assert messages[1]["content"] == RAW_TURN  # thinking + signature replayed byte for byte
    assert messages[2]["content"] == [
        {"type": "tool_result", "tool_use_id": "toolu_01A", "content": '{"card": "seasonal"}'},
        {
            "type": "tool_result",
            "tool_use_id": "toolu_01B",
            "content": '{"error": "unknown card"}',
            "is_error": True,
        },
    ]
    assert transcript[1].raw == RAW_TURN  # the stored transcript was not mutated


def test_assistant_without_raw_is_rebuilt() -> None:
    api = FakeAPI(ok([{"type": "text", "text": "Done."}]))
    other = Message(
        role="assistant",
        text="Checking.",
        tool_calls=[ToolCall(id="toolu_x", name="read_card", args={"card_id": "seasonal"})],
        provider="fake",
        raw={"not": "claude blocks"},
    )
    results = Message(role="user", tool_results=[ToolResult(call_id="toolu_x", content="{}")])
    complete(provider(api), [USER, other, results])
    assert api.last.body["messages"][1]["content"] == [
        {"type": "text", "text": "Checking."},
        {
            "type": "tool_use",
            "id": "toolu_x",
            "name": "read_card",
            "input": {"card_id": "seasonal"},
        },
    ]


def test_consecutive_user_messages_merge_results_first() -> None:
    """Paused ask_user: the other results and the answers arrive as two user messages."""
    api = FakeAPI(ok([{"type": "text", "text": "Done."}]))
    pending = Message(role="user", tool_results=[ToolResult(call_id="toolu_01A", content="{}")])
    answers = Message(
        role="user",
        text="The user answered the cards.",
        tool_results=[ToolResult(call_id="toolu_01B", content='{"answers": {"k": "v"}}')],
    )
    assistant = Message(role="assistant", provider="claude", raw=RAW_TURN)
    complete(provider(api), [USER, assistant, pending, answers])
    messages = api.last.body["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant", "user"]
    assert [b["type"] for b in messages[2]["content"]] == ["tool_result", "tool_result", "text"]
    assert [b.get("tool_use_id") for b in messages[2]["content"][:2]] == [
        "toolu_01A",
        "toolu_01B",
    ]


def test_empty_messages_are_skipped() -> None:
    api = FakeAPI(ok([{"type": "text", "text": "Done."}]))
    refused = Message(role="assistant", provider="claude", raw=[])
    complete(provider(api), [USER, refused, Message(role="user", text="Try again.")])
    messages = api.last.body["messages"]
    assert messages == [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": USER.text},
                {"type": "text", "text": "Try again."},
            ],
        }
    ]


# --- Server-side refusal fallback --------------------------------------------------------------


FALLBACK_TURN = [
    {"type": "text", "text": "Partial before the switch. ", "citations": None},
    {"type": "thinking", "thinking": "", "signature": "sig-declined"},
    {"type": "tool_use", "id": "toolu_declined", "name": "read_card", "input": {"card_id": "x"}},
    {
        "type": "fallback",
        "from": {"model": "claude-opus-5-5"},
        "to": {"model": "claude-opus-5"},
        "trigger": {"type": "refusal", "category": "cyber"},
    },
    {"type": "thinking", "thinking": "", "signature": "sig-served"},
    {"type": "tool_use", "id": "toolu_served", "name": "read_card", "input": {"card_id": "pond"}},
]


def test_fallback_turn_parsing_usage_and_replay() -> None:
    usage = {
        "input_tokens": 100,
        "output_tokens": 50,
        "iterations": [
            {
                "type": "message",
                "input_tokens": 900,
                "output_tokens": 30,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 800,
                "model": "claude-opus-5-5",
            },
            {
                "type": "fallback_message",
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_read_input_tokens": 10,
                "cache_creation_input_tokens": 0,
                "model": "claude-opus-5",
            },
        ],
    }
    api = FakeAPI(
        ok(FALLBACK_TURN, stop="tool_use", usage=usage, model="claude-opus-5"),
        ok([{"type": "text", "text": "Done."}]),
    )
    p = provider(api)
    turn = complete(p, [USER])
    # Only calls after the last fallback boundary are real (the declined ones are dropped).
    assert [c.id for c in turn.tool_calls] == ["toolu_served"]
    assert turn.raw == FALLBACK_TURN  # stored unchanged ...
    # ... and every sampling attempt is counted, not just the serving one.
    assert turn.usage == Usage(
        input_tokens=1000, output_tokens=80, cache_read_tokens=10, cache_write_tokens=800
    )

    results = Message(role="user", tool_results=[ToolResult(call_id="toolu_served", content="{}")])
    complete(p, [USER, turn.to_message(p.name), results])
    # ... but echoed by the API's rule: before the boundary only text; marker dropped.
    assert api.last.body["messages"][1]["content"] == [
        FALLBACK_TURN[0],
        FALLBACK_TURN[4],
        FALLBACK_TURN[5],
    ]


def test_fallbacks_rejected_retries_once_without_and_remembers(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG, logger=claude_mod.__name__)
    rejected = api_error(
        400,
        "invalid_request_error",
        "fallbacks: Extra inputs are not permitted (beta server-side-fallback-2026-07-01)",
    )
    api = FakeAPI(
        rejected, ok([{"type": "text", "text": "A."}]), ok([{"type": "text", "text": "B."}])
    )
    p = provider(api)
    assert complete(p, [USER]).text == "A."
    assert len(api.sent) == 2
    assert api.sent[0].url.endswith("?beta=true") and api.sent[0].body["fallbacks"] == "default"
    assert api.sent[1].url.endswith("/v1/messages")
    assert "fallbacks" not in api.sent[1].body and "anthropic-beta" not in api.sent[1].headers
    assert api.sent[1].body == {k: v for k, v in api.sent[0].body.items() if k != "fallbacks"}
    assert claude_mod._fallbacks_rejected is True
    assert any("rejected server-side fallbacks" in r.getMessage() for r in caplog.records)

    # Remembered for the process: the next call (even from a new provider) skips the beta.
    other = provider(api)
    assert complete(other, [USER]).text == "B."
    assert len(api.sent) == 3 and api.sent[2].url.endswith("/v1/messages")


def test_unrelated_400_is_not_retried() -> None:
    api = FakeAPI(api_error(400, "invalid_request_error", "messages.0.content: Field required"))
    with pytest.raises(LLMError) as info:
        complete(provider(api), [USER])
    assert len(api.sent) == 1
    assert info.value.retryable is False
    assert "400" in info.value.message and "Field required" in info.value.message
    assert claude_mod._fallbacks_rejected is False


# --- Errors ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("status", "err_type", "retryable"),
    [
        (400, "invalid_request_error", False),
        (401, "authentication_error", False),
        (403, "permission_error", False),
        (404, "not_found_error", False),
        (429, "rate_limit_error", True),
        (500, "api_error", True),
        (529, "overloaded_error", True),
    ],
)
def test_status_errors_map_to_llm_error(status: int, err_type: str, retryable: bool) -> None:
    api = FakeAPI(api_error(status, err_type, "something went wrong"))
    with pytest.raises(LLMError) as info:
        complete(provider(api, fallbacks=False), [USER])
    assert info.value.retryable is retryable
    assert str(status) in info.value.message and err_type in info.value.message
    assert FAKE_KEY not in info.value.message


def test_sdk_retries_once_then_succeeds() -> None:
    api = FakeAPI(
        api_error(529, "overloaded_error", "Overloaded", retry=True),
        ok([{"type": "text", "text": "Recovered."}]),
    )
    assert complete(provider(api), [USER]).text == "Recovered."
    assert len(api.sent) == 2


def test_sdk_retries_only_once() -> None:
    api = FakeAPI(
        api_error(429, "rate_limit_error", "Slow down", retry=True),
        api_error(429, "rate_limit_error", "Slow down", retry=True),
    )
    with pytest.raises(LLMError) as info:
        complete(provider(api), [USER])
    assert info.value.retryable is True
    assert len(api.sent) == 1 + MAX_RETRIES


def test_connection_error_is_retryable() -> None:
    def boom(request: httpx2.Request) -> httpx2.Response:
        raise httpx2.ConnectError("connection refused", request=request)

    api = FakeAPI(boom, boom)
    with pytest.raises(LLMError) as info:
        complete(provider(api), [USER])
    assert info.value.retryable is True
    assert "reach the Claude API" in info.value.message


# --- complete_json() ---------------------------------------------------------------------------


def test_complete_json_request_and_result() -> None:
    usage = {"input_tokens": 300, "output_tokens": 40, "cache_read_input_tokens": 0}
    api = FakeAPI(ok([{"type": "text", "text": '{"scope": "answerable"}'}], usage=usage))
    data, got = complete_json(provider(api))
    assert data == {"scope": "answerable"}
    assert got == Usage(input_tokens=300, output_tokens=40)

    body = api.last.body
    assert body["model"] == MODEL and body["max_tokens"] == 4000
    assert body["output_config"] == {
        "effort": "low",
        "format": {
            "type": "json_schema",
            "schema": {
                "type": "object",
                "properties": {"scope": {"type": "string", "enum": ["answerable", "refuse"]}},
                "required": ["scope"],
                "additionalProperties": False,
            },
        },
    }
    assert body["thinking"] == {"type": "adaptive"}
    assert body["system"] == [
        {"type": "text", "text": "You are the guard.", "cache_control": {"type": "ephemeral"}}
    ]
    assert body["messages"] == [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Is this question answerable from satellite data?"}
            ],
        }
    ]
    assert "tools" not in body and "tool_choice" not in body and "cache_control" not in body
    assert body["fallbacks"] == "default"


@pytest.mark.parametrize(
    ("details", "expected"),
    [({"type": "refusal", "category": "bio"}, "bio"), (None, "unspecified")],
)
def test_complete_json_refusal(details: dict[str, Any] | None, expected: str) -> None:
    api = FakeAPI(ok([], stop="refusal", stop_details=details))
    data, usage = complete_json(provider(api))
    assert data == {"_refusal": expected}
    assert usage.input_tokens == 1200


@pytest.mark.parametrize(
    ("content", "stop", "match"),
    [
        ([{"type": "text", "text": '{"scope": "ans'}], "max_tokens", "max_tokens"),
        ([{"type": "text", "text": "not json"}], "end_turn", "not valid JSON"),
        ([{"type": "text", "text": "[1, 2]"}], "end_turn", "not a JSON object"),
    ],
)
def test_complete_json_failures(content: list[dict[str, Any]], stop: str, match: str) -> None:
    with pytest.raises(LLMError, match=match):
        complete_json(provider(FakeAPI(ok(content, stop=stop))))


# --- Logging hygiene ---------------------------------------------------------------------------


def test_logs_carry_no_content_and_no_key(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG, logger=claude_mod.__name__)
    api = FakeAPI(
        ok([{"type": "text", "text": f"Answer about {SECRET_TEXT}"}]),
        api_error(500, "api_error", "internal"),
    )
    p = provider(api)
    complete(p, [Message(role="user", text=SECRET_TEXT)], system=[f"rules {SECRET_TEXT}"])
    with pytest.raises(LLMError):
        complete(p, [Message(role="user", text=SECRET_TEXT)])
    ours = [r for r in caplog.records if r.name == claude_mod.__name__]
    assert ours, "expected metadata logs"
    for record in ours:
        text = record.getMessage()
        assert FAKE_KEY not in text and SECRET_TEXT not in text
    assert all(r.levelno <= logging.DEBUG for r in ours if "request:" in r.getMessage())
