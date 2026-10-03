import pytest


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "world: world test set on real satellite data (needs network and EARTH_IMPL=real)",
    )


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip `world` tests unless `-m` selects them (network needed, not run in CI)."""
    expr = (config.getoption("-m") or "").replace(" ", "")
    if "world" in expr and "notworld" not in expr:
        return
    skip = pytest.mark.skip(reason="world tests run only with `pytest -m world` (network required)")
    for item in items:
        if "world" in item.keywords:
            item.add_marker(skip)
