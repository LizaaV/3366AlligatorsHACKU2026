"""A scripted LLM for tests (BUILD-PLAN A3): no network, deterministic.

Script each `complete` with a `Turn` (or a callable that builds one from the transcript)
and each `complete_json` with a dict (or a callable of the user text). Every call is
recorded in `calls` for assertions; running out of script raises AssertionError, so a test
fails loudly when the harness makes more calls than expected.
"""

from __future__ import annotations

import itertools
from collections.abc import Callable, Sequence
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.services.agent.llm.base import (
    Effort,
    Message,
    Pricing,
    ToolCall,
    ToolSpec,
    Turn,
    Usage,
)

__all__ = ["FakeCall", "FakeProvider", "JsonScript", "TurnScript", "text_turn", "tool_turn"]

TurnScript = Turn | Callable[[list[Message]], Turn]
JsonScript = dict[str, Any] | Callable[[str], dict[str, Any]]

#: Flat $1 per million tokens, so cost accounting is exercised (and easy to assert).
FAKE_PRICING = Pricing(input=1.0, output=1.0, cache_read=1.0, cache_write=1.0)

_ids = itertools.count(1)


class FakeCall(BaseModel):
    """One recorded provider call (inputs copied at call time)."""

    kind: Literal["complete", "json"]
    system: list[str]
    max_tokens: int
    effort: Effort
    messages: list[Message] = Field(default_factory=list)
    tools: list[ToolSpec] = Field(default_factory=list)
    user: str | None = None
    json_schema: dict[str, Any] | None = None


def tool_turn(
    *calls: tuple[str, dict[str, Any]], text: str = "", usage: Usage | None = None
) -> Turn:
    """A `tool_use` turn calling `(name, args)` pairs in order, with fresh unique ids."""
    return Turn(
        text=text,
        tool_calls=[ToolCall(id=f"toolu_fake_{next(_ids)}", name=n, args=a) for n, a in calls],
        stop="tool_use",
        usage=usage or Usage(),
    )


def text_turn(text: str, usage: Usage | None = None) -> Turn:
    """A final text turn (`stop="end"`)."""
    return Turn(text=text, stop="end", usage=usage or Usage())


class FakeProvider:
    """An `LLMProvider` that replays scripted turns and JSON answers."""

    def __init__(
        self,
        turns: Sequence[TurnScript] = (),
        json: Sequence[JsonScript] = (),
        name: str = "fake",
        model: str = "fake-1",
    ) -> None:
        self.name = name
        self.model = model
        self._turns: list[TurnScript] = list(turns)
        self._json: list[JsonScript] = list(json)
        self.calls: list[FakeCall] = []

    @property
    def remaining(self) -> tuple[int, int]:
        """Scripted (turns, json answers) not used yet."""
        return len(self._turns), len(self._json)

    async def complete(
        self,
        *,
        system: list[str],
        messages: list[Message],
        tools: list[ToolSpec],
        max_tokens: int,
        effort: Effort,
    ) -> Turn:
        """The next scripted turn (a callable gets a copy of the transcript)."""
        seen = [m.model_copy(deep=True) for m in messages]
        self.calls.append(
            FakeCall(
                kind="complete",
                system=list(system),
                messages=seen,
                tools=[t.model_copy(deep=True) for t in tools],
                max_tokens=max_tokens,
                effort=effort,
            )
        )
        if not self._turns:
            raise AssertionError(
                f"FakeProvider ran out of scripted turns (complete call #{self._count('complete')})"
            )
        step = self._turns.pop(0)
        turn = step(seen) if callable(step) else step
        if not isinstance(turn, Turn):
            raise AssertionError(f"scripted turn must be a Turn, got {type(turn).__name__}")
        return turn.model_copy(deep=True)

    async def complete_json(
        self,
        *,
        system: list[str],
        user: str,
        schema: dict[str, Any],
        max_tokens: int,
        effort: Effort,
    ) -> tuple[dict[str, Any], Usage]:
        """The next scripted JSON answer (a callable gets the user text), with zero usage."""
        self.calls.append(
            FakeCall(
                kind="json",
                system=list(system),
                user=user,
                json_schema=dict(schema),
                max_tokens=max_tokens,
                effort=effort,
            )
        )
        if not self._json:
            raise AssertionError(
                f"FakeProvider ran out of scripted JSON answers (json call #{self._count('json')})"
            )
        step = self._json.pop(0)
        data = step(user) if callable(step) else step
        if not isinstance(data, dict):
            raise AssertionError(f"scripted JSON must be a dict, got {type(data).__name__}")
        return dict(data), Usage()

    def cost_usd(self, usage: Usage) -> float:
        """Flat $1 per million tokens of any kind."""
        return FAKE_PRICING.cost_usd(usage)

    def _count(self, kind: str) -> int:
        return sum(1 for c in self.calls if c.kind == kind)
