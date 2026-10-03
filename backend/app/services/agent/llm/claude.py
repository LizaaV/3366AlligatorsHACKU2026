"""Claude provider for the agent loop (BUILD-PLAN A3): `LLMProvider` over the Anthropic SDK.

Maps the neutral types in `llm.base` to the Messages API and back:

- `system` parts become text blocks with a cache breakpoint on the last one (tools render
  before system, so that one breakpoint caches tools + system); the growing conversation is
  cached with top-level automatic caching.
- Tools are sent with `strict: true` and `tool_choice` auto: forcing a tool is a 400 on
  Claude Opus 5.5, so the harness steers by prompt and checks that a call happened.
- Thinking is adaptive (it cannot be turned off on Claude Opus 5.5); depth is set with
  `output_config.effort`. No temperature, no thinking budget.
- An assistant turn's content blocks (thinking included) are kept as `Turn.raw` and replayed
  unchanged on the next request (preserved thinking). The transcript is append-only.
- All tool results answering one assistant turn travel in one user message.
- Refusal fallback (beta `server-side-fallback-2026-07-01`, `fallbacks="default"`) is on when
  the provider is built with `fallbacks=True` (`settings.llm_fallbacks`). If the API rejects
  it with a 400 naming fallbacks or betas, the call is retried once without, and fallbacks
  stay off for the rest of the process.

Logs carry metadata only (model, sizes, stop reason, usage, request id): never message
content, never the API key.
"""

from __future__ import annotations

import copy
import json
import logging
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

import anthropic

from app.services.agent.llm.base import (
    Effort,
    LLMError,
    Message,
    Pricing,
    StopReason,
    ToolCall,
    ToolSpec,
    Turn,
    Usage,
)

if TYPE_CHECKING:  # the SDK's HTTP layer; only for the injectable test transport
    import httpx2

__all__ = [
    "CLAUDE_PRICING",
    "DEFAULT_TIMEOUT_S",
    "FALLBACK_BETA",
    "MAX_RETRIES",
    "ClaudeProvider",
]

logger = logging.getLogger(__name__)

#: USD per million tokens for Claude Opus 5.5 (cache writes at the 5-minute TTL).
CLAUDE_PRICING = Pricing(input=4.00, output=20.00, cache_read=0.20, cache_write=5.00)
#: Beta header for the scalar `fallbacks="default"` form of server-side refusal fallback.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
#: Seconds per request (read/write); the SDK retries a failed request once.
DEFAULT_TIMEOUT_S = 120.0
CONNECT_TIMEOUT_S = 10.0
MAX_RETRIES = 1

_EPHEMERAL = {"type": "ephemeral"}
_STOP: dict[str, StopReason] = {
    "end_turn": "end",
    "stop_sequence": "end",
    "tool_use": "tool_use",
    "max_tokens": "max_tokens",
    "model_context_window_exceeded": "max_tokens",
    "refusal": "refusal",
}
#: HTTP statuses worth retrying later (besides 5xx), as the SDK's own retry policy.
_RETRYABLE_STATUS = frozenset({408, 409, 429})
_MAX_ERROR_DETAIL = 300
#: `usage.iterations` entries that are sampling attempts (declined or serving).
_ATTEMPTS = frozenset({"message", "fallback_message"})

#: Set once the API rejects server-side fallbacks; later calls in this process skip them.
_fallbacks_rejected = False


class ClaudeProvider:
    """`LLMProvider` backed by `anthropic.AsyncAnthropic` (built by `llm.get_provider`)."""

    name = "claude"

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        fallbacks: bool,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        http_client: httpx2.AsyncClient | None = None,
    ) -> None:
        self.name = "claude"
        self.model = model
        self.fallbacks = fallbacks
        self.pricing = CLAUDE_PRICING
        self._client = anthropic.AsyncAnthropic(
            api_key=api_key,
            max_retries=MAX_RETRIES,
            timeout=anthropic.Timeout(timeout_s, connect=min(CONNECT_TIMEOUT_S, timeout_s)),
            http_client=http_client,
        )

    def __repr__(self) -> str:
        return f"ClaudeProvider(model={self.model!r}, fallbacks={self.fallbacks})"

    # --- LLMProvider --------------------------------------------------------------------------

    async def complete(
        self,
        *,
        system: list[str],
        messages: list[Message],
        tools: list[ToolSpec],
        max_tokens: int,
        effort: Effort,
    ) -> Turn:
        """One model turn over the transcript. Raises LLMError on failure.

        On `stop="refusal"` the turn carries no tool calls (a refusal can cut a call off
        mid-input, so none may run). On `stop="max_tokens"` any tool calls are returned as
        parsed but may be truncated: the harness should answer them with an error result.
        """
        system_blocks = _system_blocks(system)
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": self._api_messages(messages),
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": effort},
            "cache_control": dict(_EPHEMERAL),  # automatic caching of the conversation tail
        }
        if system_blocks:
            params["system"] = system_blocks
        if tools:
            params["tools"] = _tool_params(tools, cache_last=not system_blocks)
            params["tool_choice"] = {"type": "auto"}
        response = await self._create(params, purpose="turn")
        return _turn(response)

    async def complete_json(
        self,
        *,
        system: list[str],
        user: str,
        schema: dict[str, Any],
        max_tokens: int,
        effort: Effort,
    ) -> tuple[dict[str, Any], Usage]:
        """One structured call (`output_config.format` json_schema) returning a JSON object.

        Raises LLMError on failure, including output cut off at `max_tokens` or not a JSON
        object. On a refusal returns `{"_refusal": category}` (category "unspecified" when
        the API names none).
        """
        system_blocks = _system_blocks(system)
        params: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": [{"type": "text", "text": user}]}],
            "thinking": {"type": "adaptive"},
            "output_config": {
                "effort": effort,
                "format": {"type": "json_schema", "schema": _strict_schema(schema)},
            },
        }
        if system_blocks:
            params["system"] = system_blocks
        response = await self._create(params, purpose="json")
        usage = _usage(getattr(response, "usage", None))
        stop = _stop(getattr(response, "stop_reason", None), has_calls=False)
        if stop == "refusal":
            category = _refusal_category(response)
            logger.warning("Claude declined a structured call (category=%s).", category)
            return {"_refusal": category or "unspecified"}, usage
        if stop == "max_tokens":
            raise LLMError("Claude's structured output was cut off at max_tokens.")
        _, served = _split_at_fallback([_block_dict(b) for b in response.content])
        text = "".join(b.get("text", "") for b in served if b.get("type") == "text")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise LLMError("Claude's structured output was not valid JSON.") from exc
        if not isinstance(data, dict):
            raise LLMError("Claude's structured output was not a JSON object.")
        return data, usage

    def cost_usd(self, usage: Usage) -> float:
        """USD for `usage` at Claude Opus 5.5 prices (fallback attempts priced the same)."""
        return self.pricing.cost_usd(usage)

    async def aclose(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.close()

    # --- Request building ---------------------------------------------------------------------

    def _api_messages(self, messages: Sequence[Message]) -> list[dict[str, Any]]:
        """Neutral transcript -> Anthropic `messages`.

        Consecutive user messages are merged into one, tool results first, so every result
        answering an assistant turn is in the single user message that follows it.
        """
        out: list[dict[str, Any]] = []
        for msg in messages:
            if msg.role == "assistant":
                content = self._assistant_content(msg)
            else:
                content = _user_content(msg)
            if not content:
                continue  # the API rejects empty messages; there is nothing to send
            if msg.role == "user" and out and out[-1]["role"] == "user":
                out[-1]["content"] = _results_first([*out[-1]["content"], *content])
            else:
                out.append({"role": msg.role, "content": content})
        return out

    def _assistant_content(self, msg: Message) -> list[dict[str, Any]]:
        """Replay this provider's raw blocks unchanged; rebuild anything else from fields."""
        if msg.provider == self.name and isinstance(msg.raw, list):
            return _replay_blocks(msg.raw)
        blocks: list[dict[str, Any]] = []
        if msg.text and msg.text.strip():
            blocks.append({"type": "text", "text": msg.text})
        for call in msg.tool_calls:
            blocks.append(
                {"type": "tool_use", "id": call.id, "name": call.name, "input": call.args}
            )
        return blocks

    async def _create(self, params: dict[str, Any], *, purpose: str) -> Any:
        """Send one Messages request (with refusal fallback when enabled); map SDK errors."""
        global _fallbacks_rejected
        logger.debug(
            "claude %s request: model=%s effort=%s max_tokens=%s messages=%d tools=%d",
            purpose,
            params["model"],
            params["output_config"].get("effort"),
            params["max_tokens"],
            len(params["messages"]),
            len(params.get("tools", ())),
        )
        try:
            response: Any = None
            if self.fallbacks and not _fallbacks_rejected:
                try:
                    response = await self._client.beta.messages.create(
                        **params, betas=[FALLBACK_BETA], fallbacks="default"
                    )
                except anthropic.BadRequestError as exc:
                    if not _about_fallbacks(exc):
                        raise
                    _fallbacks_rejected = True
                    logger.warning(
                        "Claude API rejected server-side fallbacks (HTTP 400, request %s); "
                        "retrying without them for the rest of this process.",
                        exc.request_id,
                    )
            if response is None:
                response = await self._client.messages.create(**params)
        except anthropic.AnthropicError as exc:
            error = _llm_error(exc)
            logger.warning("claude %s request failed: %s", purpose, error.message)
            raise error from exc
        logger.debug(
            "claude %s response: stop=%s served_by=%s usage=%s request=%s",
            purpose,
            getattr(response, "stop_reason", None),
            getattr(response, "model", None),
            _usage(getattr(response, "usage", None)).model_dump(),
            getattr(response, "_request_id", None),
        )
        return response


# --- Helpers ----------------------------------------------------------------------------------


def _system_blocks(system: Sequence[str]) -> list[dict[str, Any]]:
    """Stable system parts as text blocks; the cache breakpoint goes on the last one."""
    blocks: list[dict[str, Any]] = [
        {"type": "text", "text": part} for part in system if part and part.strip()
    ]
    if blocks:
        blocks[-1]["cache_control"] = dict(_EPHEMERAL)
    return blocks


def _tool_params(tools: Sequence[ToolSpec], *, cache_last: bool) -> list[dict[str, Any]]:
    """Tool definitions with `strict: true` (in the harness's order, which is stable)."""
    params: list[dict[str, Any]] = [
        {
            "name": tool.name,
            "description": tool.description,
            "input_schema": _strict_schema(tool.input_schema),
            "strict": True,
        }
        for tool in tools
    ]
    if cache_last and params:  # no system prompt: cache the tools on their own
        params[-1]["cache_control"] = dict(_EPHEMERAL)
    return params


def _strict_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """The schema in the subset strict mode accepts (the SDK's own `transform_schema`):
    `additionalProperties: false` on objects, unsupported constraints (e.g. `maxItems: 3`)
    moved into descriptions. A schema it cannot handle (e.g. `type: [..., "null"]`) is sent
    unchanged."""
    try:
        return anthropic.transform_schema(copy.deepcopy(schema))
    except (AssertionError, AttributeError, KeyError, TypeError, ValueError):
        return copy.deepcopy(schema)


def _user_content(msg: Message) -> list[dict[str, Any]]:
    """Tool results first (as the API requires), then the text."""
    blocks: list[dict[str, Any]] = []
    for result in msg.tool_results:
        block: dict[str, Any] = {
            "type": "tool_result",
            "tool_use_id": result.call_id,
            "content": result.content,
        }
        if result.is_error:
            block["is_error"] = True
        blocks.append(block)
    if msg.text and msg.text.strip():
        blocks.append({"type": "text", "text": msg.text})
    return blocks


def _results_first(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Stable partition: tool_result blocks before everything else."""
    results = [b for b in blocks if b.get("type") == "tool_result"]
    return results + [b for b in blocks if b.get("type") != "tool_result"]


def _split_at_fallback(
    blocks: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(blocks before the last `fallback` boundary, blocks after it). Without a fallback
    block everything is "after"."""
    last = max((i for i, b in enumerate(blocks) if b.get("type") == "fallback"), default=-1)
    if last < 0:
        return [], blocks
    return blocks[:last], blocks[last + 1 :]


def _replay_blocks(raw: list[Any]) -> list[dict[str, Any]]:
    """Raw content blocks to send back, unchanged.

    After a refusal fallback, only the text of what came before the last `fallback` block
    is echoed (thinking and tool_use blocks there are dropped, as the API requires); the
    `fallback` marker itself is dropped too (it is an ignored audit marker).
    """
    blocks = [copy.deepcopy(b) for b in raw if isinstance(b, dict)]
    before, after = _split_at_fallback(blocks)
    return [b for b in before if b.get("type") == "text"] + after


def _block_dict(block: Any) -> dict[str, Any]:
    """An SDK content block as the JSON the API sent (API field names, unset fields left out)."""
    if isinstance(block, dict):
        return copy.deepcopy(block)
    return block.to_dict(mode="json")


def _turn(response: Any) -> Turn:
    """Anthropic response -> neutral `Turn` (raw = every content block, unchanged)."""
    raw = [_block_dict(b) for b in response.content]
    _, served = _split_at_fallback(raw)
    text = "\n\n".join(
        b["text"].strip()
        for b in raw
        if b.get("type") == "text" and isinstance(b.get("text"), str) and b["text"].strip()
    )
    calls = [
        ToolCall(
            id=b["id"],
            name=b["name"],
            args=copy.deepcopy(b["input"]) if isinstance(b.get("input"), dict) else {},
        )
        for b in served
        if b.get("type") == "tool_use"
    ]
    stop = _stop(getattr(response, "stop_reason", None), has_calls=bool(calls))
    category: str | None = None
    if stop == "refusal":
        calls = []  # a refusal can cut a tool call off mid-input: never run it
        category = _refusal_category(response)
        logger.warning("Claude declined the turn (category=%s).", category)
    return Turn(
        text=text,
        tool_calls=calls,
        stop=stop,
        usage=_usage(getattr(response, "usage", None)),
        raw=raw,
        refusal_category=category,
    )


def _stop(reason: str | None, *, has_calls: bool) -> StopReason:
    """API stop_reason -> neutral stop (tool calls decide anything unexpected)."""
    stop = _STOP.get(reason or "")
    if stop is None:
        logger.warning("Unexpected Claude stop_reason %r.", reason)
        stop = "tool_use" if has_calls else "end"
    if stop == "tool_use" and not has_calls:
        return "end"
    if stop == "end" and has_calls:
        return "tool_use"
    return stop


def _refusal_category(response: Any) -> str | None:
    details = getattr(response, "stop_details", None)
    category = getattr(details, "category", None) if details is not None else None
    return str(category) if category else None


def _one_usage(usage: Any) -> Usage:
    return Usage(
        input_tokens=getattr(usage, "input_tokens", None) or 0,
        output_tokens=getattr(usage, "output_tokens", None) or 0,
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", None) or 0,
        cache_write_tokens=getattr(usage, "cache_creation_input_tokens", None) or 0,
    )


def _usage(usage: Any) -> Usage:
    """Token usage of a response. After a refusal fallback the top-level usage covers only
    the serving attempt, so every sampling attempt in `usage.iterations` is summed."""
    if usage is None:
        return Usage()
    iterations = getattr(usage, "iterations", None) or []
    kinds = [getattr(item, "type", None) for item in iterations]
    if "fallback_message" in kinds:
        attempts = [i for i, k in zip(iterations, kinds, strict=True) if k in _ATTEMPTS]
        return sum((_one_usage(item) for item in attempts), Usage())
    return _one_usage(usage)


def _about_fallbacks(exc: anthropic.APIStatusError) -> bool:
    """Whether a 400 is about the fallback opt-in (the beta header or the parameter)."""
    text = f"{exc.message} {json.dumps(exc.body, default=str)}".lower()
    return "fallback" in text or "beta" in text


def _api_detail(exc: anthropic.APIStatusError) -> str:
    body = exc.body
    detail: Any = None
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        detail = body["error"].get("message")
    text = str(detail or exc.message)
    return text if len(text) <= _MAX_ERROR_DETAIL else text[: _MAX_ERROR_DETAIL - 3] + "..."


def _llm_error(exc: anthropic.AnthropicError) -> LLMError:
    """SDK exception -> LLMError (retryable for timeouts, connection errors, 408/409/429/5xx).
    The SDK has already retried once by then."""
    if isinstance(exc, anthropic.APITimeoutError):
        return LLMError("The Claude API timed out.", retryable=True)
    if isinstance(exc, anthropic.APIConnectionError):
        return LLMError("Could not reach the Claude API.", retryable=True)
    if isinstance(exc, anthropic.APIStatusError):
        status = exc.status_code
        retryable = status in _RETRYABLE_STATUS or status >= 500
        kind = exc.type or "error"
        return LLMError(
            f"Claude API error {status} ({kind}): {_api_detail(exc)}", retryable=retryable
        )
    return LLMError(f"Claude API error: {type(exc).__name__}.", retryable=False)
