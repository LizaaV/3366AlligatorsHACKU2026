"""LLM providers for the agent loop (BUILD-PLAN A3).

`get_provider(name)` picks one by name (None = `settings.llm_provider`):

- `"claude"` needs `ANTHROPIC_API_KEY`; built from `app.services.agent.llm.claude`, which
  must define `ClaudeProvider(*, api_key: str, model: str, fallbacks: bool)`.
- `"fake"` (scripted, tests only) needs `settings.allow_fake_provider`.

Anything else, or a provider that is not configured, raises `ProviderUnavailable`. Tests
can pin a provider for every call with `set_provider_override`.
"""

from __future__ import annotations

import sys
from importlib.util import find_spec

from app.core.config import settings
from app.services.agent.llm.base import (
    Effort,
    LLMError,
    LLMProvider,
    Message,
    Pricing,
    ProviderUnavailable,
    StopReason,
    ToolCall,
    ToolResult,
    ToolSpec,
    Turn,
    Usage,
)

__all__ = [
    "KNOWN_PROVIDERS",
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
    "available_providers",
    "get_provider",
    "set_provider_override",
]

#: Provider names `get_provider` knows about.
KNOWN_PROVIDERS: tuple[str, ...] = ("claude", "fake")

_override: LLMProvider | None = None


def set_provider_override(provider: LLMProvider | None) -> None:
    """Make `get_provider` return `provider` for any known name (tests); None clears it."""
    global _override
    _override = provider


def _api_key() -> str | None:
    key = settings.anthropic_api_key
    value = key.get_secret_value().strip() if key is not None else ""
    return value or None


def _claude_installed() -> bool:
    name = f"{__name__}.claude"
    if name in sys.modules:
        return sys.modules[name] is not None
    try:
        return find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def available_providers() -> list[str]:
    """Provider names that `get_provider` would accept right now."""
    if _override is not None:  # tests: every known name resolves to the override
        return list(dict.fromkeys([*KNOWN_PROVIDERS, _override.name]))
    names: list[str] = []
    if _api_key() is not None and _claude_installed():
        names.append("claude")
    if settings.allow_fake_provider:
        names.append("fake")
    return names


def get_provider(name: str | None = None) -> LLMProvider:
    """The provider called `name` (None = `settings.llm_provider`).

    Raises ProviderUnavailable for an unknown name, the fake provider when
    `settings.allow_fake_provider` is off, or Claude without an API key.
    """
    name = name or settings.llm_provider
    if _override is not None and (name in KNOWN_PROVIDERS or name == _override.name):
        return _override
    if name == "fake":
        if not settings.allow_fake_provider:
            raise ProviderUnavailable("The fake LLM provider is for tests only.")
        from app.services.agent.llm.fake import FakeProvider

        return FakeProvider()
    if name == "claude":
        key = _api_key()
        if key is None:
            raise ProviderUnavailable("Claude is not configured: set ANTHROPIC_API_KEY.")
        try:
            from app.services.agent.llm.claude import ClaudeProvider
        except ModuleNotFoundError as exc:
            if exc.name != f"{__name__}.claude":
                raise  # a real bug inside the module, not a missing module
            raise ProviderUnavailable("The Claude provider is not installed.") from exc
        return ClaudeProvider(
            api_key=key, model=settings.claude_model, fallbacks=settings.llm_fallbacks
        )
    raise ProviderUnavailable(f"Unknown LLM provider: {name!r}.")
