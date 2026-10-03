"""Provider-neutral LLM types for the agent loop (BUILD-PLAN A3, frozen interface).

The harness only speaks these types. A provider maps them to its own API and back:

- `system` is a list of STABLE prompt parts (rules, card index, API reference), so a
  provider can cache them; anything per run goes in `messages`.
- `Message.raw` is a provider-private, JSON-serialisable payload (e.g. Claude's content
  blocks incl. thinking) that only the same provider replays, unchanged. The transcript is
  append-only: earlier messages are never edited.
"""

from __future__ import annotations

from typing import Any, Literal, Protocol, runtime_checkable

from pydantic import BaseModel, Field

__all__ = [
    "Effort",
    "LLMError",
    "LLMProvider",
    "Message",
    "Pricing",
    "ProviderUnavailable",
    "StopReason",
    "ToolCall",
    "ToolResult",
    "ToolSpec",
    "Turn",
    "Usage",
]

#: How hard the model thinks (Claude `output_config.effort`).
Effort = Literal["low", "medium", "high"]
#: Why a turn ended: tools requested, final text, out of tokens, or the model declined.
StopReason = Literal["tool_use", "end", "max_tokens", "refusal"]


class ToolSpec(BaseModel):
    """A tool the model may call. `input_schema` is a strict JSON schema (all properties
    required, `additionalProperties: false`, optional values as nullable types)."""

    name: str
    description: str
    input_schema: dict[str, Any]


class ToolCall(BaseModel):
    """One tool call requested by the model; `args` is the parsed JSON input."""

    id: str
    name: str
    args: dict[str, Any] = Field(default_factory=dict)


class ToolResult(BaseModel):
    """The harness's answer to one tool call (compact JSON text)."""

    call_id: str
    content: str
    is_error: bool = False


class Usage(BaseModel):
    """Token usage; add two with `+`."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    def __add__(self, other: Usage) -> Usage:
        if not isinstance(other, Usage):
            return NotImplemented
        return Usage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            cache_read_tokens=self.cache_read_tokens + other.cache_read_tokens,
            cache_write_tokens=self.cache_write_tokens + other.cache_write_tokens,
        )

    @property
    def total_tokens(self) -> int:
        """All tokens billed, cached or not (for `done.tokens`)."""
        return (
            self.input_tokens
            + self.output_tokens
            + self.cache_read_tokens
            + self.cache_write_tokens
        )


class Pricing(BaseModel):
    """USD per million tokens, by kind."""

    input: float
    output: float
    cache_read: float = 0.0
    cache_write: float = 0.0

    def cost_usd(self, usage: Usage) -> float:
        """The cost of `usage` at these prices."""
        return (
            usage.input_tokens * self.input
            + usage.output_tokens * self.output
            + usage.cache_read_tokens * self.cache_read
            + usage.cache_write_tokens * self.cache_write
        ) / 1_000_000


class Message(BaseModel):
    """One transcript message.

    A user message carries `text` and/or `tool_results`; an assistant message carries
    `text` and/or `tool_calls`. `raw` (with `provider`) is replayed only by that provider.
    """

    role: Literal["user", "assistant"]
    text: str | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tool_results: list[ToolResult] = Field(default_factory=list)
    provider: str | None = None
    raw: Any = None


class Turn(BaseModel):
    """One model response."""

    text: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)
    stop: StopReason
    usage: Usage = Field(default_factory=Usage)
    raw: Any = None
    refusal_category: str | None = None

    def to_message(self, provider: str) -> Message:
        """The assistant message to append to the transcript (raw payload kept)."""
        return Message(
            role="assistant",
            text=self.text or None,
            tool_calls=[c.model_copy(deep=True) for c in self.tool_calls],
            provider=provider,
            raw=self.raw,
        )


class LLMError(Exception):
    """The provider call failed. `retryable`: worth trying again (rate limit, overload)."""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.message = message
        self.retryable = retryable


class ProviderUnavailable(Exception):
    """The requested provider is unknown, not allowed or not configured (e.g. no key)."""


@runtime_checkable
class LLMProvider(Protocol):
    """What the agent loop needs from an LLM."""

    name: str
    model: str

    async def complete(
        self,
        *,
        system: list[str],
        messages: list[Message],
        tools: list[ToolSpec],
        max_tokens: int,
        effort: Effort,
    ) -> Turn:
        """One model turn over the transcript. Raises LLMError on failure."""
        ...

    async def complete_json(
        self,
        *,
        system: list[str],
        user: str,
        schema: dict[str, Any],
        max_tokens: int,
        effort: Effort,
    ) -> tuple[dict[str, Any], Usage]:
        """One structured call returning JSON matching `schema` (e.g. the guard).

        Raises LLMError on failure; on a refusal returns `{"_refusal": category}`.
        """
        ...

    def cost_usd(self, usage: Usage) -> float:
        """USD for `usage` at this provider's prices."""
        ...
