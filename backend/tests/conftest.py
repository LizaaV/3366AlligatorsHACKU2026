from collections.abc import Iterator

import pytest

from app.core.config import settings


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "world: world test set on real satellite data (needs network and EARTH_IMPL=real)",
    )
    config.addinivalue_line(
        "markers",
        "live: calls the real Claude API (run only with `pytest -m live` and ANTHROPIC_API_KEY)",
    )


def _selected(markexpr: str, marker: str) -> bool:
    """Whether a `-m` expression explicitly selects `marker` (and not `not <marker>`)."""
    expr = (markexpr or "").replace(" ", "")
    return marker in expr and f"not{marker}" not in expr


def _api_key_configured() -> bool:
    key = settings.anthropic_api_key
    return key is not None and bool(key.get_secret_value().strip())


def live_skip_reason(markexpr: str, key_configured: bool) -> str | None:
    """Why `live` tests are skipped for this session, or None when they may run."""
    if not _selected(markexpr, "live"):
        return "live tests run only with `pytest -m live` (real Claude API calls)"
    if not key_configured:
        return "live tests need ANTHROPIC_API_KEY"
    return None


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip `world` tests unless `-m` selects them (network needed, not run in CI), and
    `live` tests unless `-m` selects them and an Anthropic API key is configured."""
    markexpr = config.getoption("-m") or ""
    if not _selected(markexpr, "world"):
        skip = pytest.mark.skip(
            reason="world tests run only with `pytest -m world` (network required)"
        )
        for item in items:
            if "world" in item.keywords:
                item.add_marker(skip)
    reason = live_skip_reason(markexpr, _api_key_configured())
    if reason is not None:
        skip_live = pytest.mark.skip(reason=reason)
        for item in items:
            if "live" in item.keywords:
                item.add_marker(skip_live)


@pytest.fixture(autouse=True)
def _offline_llm(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Every non-`live` test uses the scripted fake LLM: the fake provider is allowed and
    the default, and no API key is visible, so nothing can reach the real API by accident.
    Restored (and any provider override cleared) afterwards."""
    from app.services.agent import llm

    if request.node.get_closest_marker("live") is None:
        monkeypatch.setattr(settings, "allow_fake_provider", True)
        monkeypatch.setattr(settings, "llm_provider", "fake")
        monkeypatch.setattr(settings, "anthropic_api_key", None)
        monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    try:
        yield
    finally:
        llm.set_provider_override(None)


@pytest.fixture(autouse=True)
def _fresh_rate_limits() -> Iterator[None]:
    """Each test starts with empty hourly rate windows (A4 anti-spam gate)."""
    from app.services.agent import policy

    policy.reset_rates()
    yield
    policy.reset_rates()
