"""Live check of the Claude adapter against the real API (BUILD-PLAN A3).

Runs only with `pytest -m live` and ANTHROPIC_API_KEY (skipped otherwise, see conftest).
Tiny calls at effort low confirm the request shape end to end: a strict tool with tool_choice
auto, adaptive thinking, effort, cache breakpoints and the refusal-fallback opt-in; then a
second request that replays the first turn's raw blocks (thinking included) with the tool
result; then one structured-output call. A few cents in total. Prints metadata only (stop
reasons, block types, usage, cost), never content or the key.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from app.services.agent.llm import Message, ToolResult, ToolSpec, Usage, get_provider
from app.services.agent.llm import claude as claude_mod
from app.services.agent.llm.claude import ClaudeProvider

pytestmark = pytest.mark.live

#: Spend ceiling for the whole file (USD); the expected total is around $0.02.
MAX_COST_USD = 0.10

#: A stable system prompt above the 512-token cache minimum, so the replay request can read
#: the tools + system prefix that the first request wrote to the cache.
SYSTEM = [
    "You are a careful arithmetic assistant used to test an API integration.",
    "\n".join(
        f"House rule {i}: when the user asks for a sum, call the add_numbers tool with the two "
        "integers exactly as given, wait for its result, then answer with that number only."
        for i in range(1, 31)
    ),
]

ADD = ToolSpec(
    name="add_numbers",
    description="Add two integers. Call this whenever the user asks for the sum of two numbers.",
    input_schema={
        "type": "object",
        "properties": {
            "a": {"type": "integer", "description": "First addend."},
            "b": {"type": "integer", "description": "Second addend."},
        },
        "required": ["a", "b"],
        "additionalProperties": False,
    },
)


def _claude() -> ClaudeProvider:
    provider = get_provider("claude")
    assert isinstance(provider, ClaudeProvider)
    return provider


def _report(label: str, usage: Usage, cost: float) -> None:
    print(f"[live] {label}: usage={usage.model_dump()} cost=${cost:.5f}")


def test_tool_turn_then_raw_replay() -> None:
    async def scenario() -> None:
        claude = _claude()
        print(f"[live] model={claude.model} fallbacks={claude.fallbacks}")
        try:
            user = Message(
                role="user", text="Use the add_numbers tool to add 17 and 25, then tell me."
            )
            first = await claude.complete(
                system=SYSTEM, messages=[user], tools=[ADD], max_tokens=2000, effort="low"
            )
            types = [b.get("type") for b in first.raw or []]
            print(f"[live] turn 1: stop={first.stop} blocks={types}")
            _report("turn 1", first.usage, claude.cost_usd(first.usage))
            assert first.stop == "tool_use", first.stop
            assert len(first.tool_calls) == 1
            call = first.tool_calls[0]
            assert call.name == "add_numbers"
            assert call.args == {"a": 17, "b": 25}

            transcript = [
                user,
                first.to_message(claude.name),
                Message(
                    role="user",
                    tool_results=[ToolResult(call_id=call.id, content=json.dumps({"sum": 42}))],
                ),
            ]
            # As the run store does between turns: the raw blocks go through JSON.
            transcript = [Message.model_validate_json(m.model_dump_json()) for m in transcript]
            second = await claude.complete(
                system=SYSTEM, messages=transcript, tools=[ADD], max_tokens=2000, effort="low"
            )
            print(
                f"[live] turn 2: stop={second.stop} "
                f"blocks={[b.get('type') for b in second.raw or []]}"
            )
            _report("turn 2", second.usage, claude.cost_usd(second.usage))
            assert second.stop == "end", second.stop
            assert "42" in second.text
            assert second.tool_calls == []
            assert second.usage.cache_read_tokens > 0, "tools + system prefix was not cached"

            total = claude.cost_usd(first.usage + second.usage)
            print(f"[live] total cost=${total:.5f}")
            assert total < MAX_COST_USD
            assert claude_mod._fallbacks_rejected is False, "API rejected server-side fallbacks"
        finally:
            await claude.aclose()

    asyncio.run(scenario())


def test_structured_output() -> None:
    async def scenario() -> None:
        claude = _claude()
        try:
            data, usage = await claude.complete_json(
                system=["Answer arithmetic questions in the requested JSON shape."],
                user="What is 6 times 7?",
                schema={
                    "type": "object",
                    "properties": {"product": {"type": "integer"}},
                    "required": ["product"],
                    "additionalProperties": False,
                },
                max_tokens=1000,
                effort="low",
            )
            _report("json", usage, claude.cost_usd(usage))
            assert data == {"product": 42}
            assert usage.output_tokens > 0
            assert claude.cost_usd(usage) < MAX_COST_USD
        finally:
            await claude.aclose()

    asyncio.run(scenario())
