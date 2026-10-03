"""Contract test for the `earth` public API (BUILD-PLAN I1).

Runs against the stub by default. The real implementation must pass the same test:
    EARTH_IMPL=real uv run pytest tests/contracts/test_earth.py
"""

from __future__ import annotations

import json
import math
from datetime import date

import pytest
from pydantic import ValidationError

import earth
from earth.blocks import BLOCK_TYPES, BlockAdapter, validate_block
from earth.presets import HOO_HOK_WAI

AREA = HOO_HOK_WAI


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    earth.set_run("r_test")
    earth.set_listener(None)
    yield
    earth.set_run(None)


def _small(model) -> None:
    """Results must be small JSON, never arrays."""
    raw = json.dumps(model.model_dump(mode="json"))
    assert len(raw) < 200_000


# --- Area ---------------------------------------------------------------------------------------


def test_area_from_point_has_true_hectares():
    a = earth.Area.from_point(22.5, 114.0, radius_m=400)
    assert a.area_ha == pytest.approx(math.pi * 400**2 / 10_000, rel=0.01)
    assert a.geojson["type"] == "Polygon"


def test_area_from_geojson_feature_and_southern_hemisphere():
    feature = {
        "type": "Feature",
        "properties": {"name": "Field"},
        "geometry": {
            "type": "Polygon",
            "coordinates": [
                [[-63.0, -10.0], [-62.99, -10.0], [-62.99, -9.99], [-63.0, -9.99], [-63.0, -10.0]]
            ],
        },
    }
    a = earth.Area.from_geojson(feature)
    assert a.name == "Field"
    assert 100 < a.area_ha < 130  # ~1.1 km × 1.1 km
    assert a.utm_epsg() == 32720


def test_area_rejects_non_polygon():
    with pytest.raises(earth.InvalidArea) as e:
        earth.Area.from_geojson({"type": "Point", "coordinates": [114.0, 22.5]})
    assert e.value.hint


def test_surroundings_is_a_ring_outside_the_area():
    ring = earth.surroundings(AREA, ring_m=300)
    assert ring.is_ring() and not AREA.is_ring()
    assert ring.area_ha > AREA.area_ha
    assert not ring.geometry().intersection(AREA.geometry()).area > 1e-9


# --- Read → measure ------------------------------------------------------------------------------


def test_describe():
    ctx = earth.describe(AREA)
    assert ctx.area_ha == pytest.approx(AREA.area_ha)
    assert ctx.pixels_10m > 0
    assert sum(ctx.land_cover.values()) == pytest.approx(1, abs=0.05)
    _small(ctx)


def test_scenes_cloud_is_over_the_area_and_usable_respects_max_cloud():
    s = earth.scenes(AREA, last="60d", max_cloud=30)
    assert s.scenes, "no scenes in 60 days"
    assert [x.date for x in s.scenes] == sorted((x.date for x in s.scenes), reverse=True)
    for x in s.scenes:
        assert 0 <= x.cloud_over_area <= 1
        assert x.usable == (x.cloud_over_area * 100 <= 30) or not x.usable
    assert s.latest_clear().usable
    _small(s)


def test_load_index_measure_returns_stats_with_provenance():
    scene = earth.scenes(AREA, last="60d").latest_clear()
    g = earth.index(earth.load(AREA, scene), "greenness")
    stats = earth.measure(g)
    assert -1 <= stats.p10 <= stats.median <= stats.p90 <= 1
    assert stats.clean_px > 0
    assert stats.provenance.scene == scene.id
    assert stats.provenance.date == scene.date
    _small(stats)


def test_series_returns_points_and_band():
    s = earth.series(AREA, "greenness", years=4)
    assert len(s.points) >= 12
    assert [p.date for p in s.points] == sorted(p.date for p in s.points)
    assert all(-1 <= p.value <= 1 for p in s.points)
    assert {b.month for b in s.band} <= set(range(1, 13))
    _small(s)


def test_compare_returns_delta_and_patches():
    c = earth.compare(AREA, "greenness", before="2024-09-14", after=date(2026, 9, 30))
    assert c.delta == pytest.approx(c.after.mean - c.before.mean, abs=1e-3)
    assert c.changed_ha <= AREA.area_ha
    assert all(p.ha > 0 for p in c.patches)
    _small(c)


def test_render_writes_png_and_returns_url_and_bounds(tmp_path):
    scene = earth.scenes(AREA, last="60d").latest_clear()
    g = earth.index(earth.load(AREA, scene), "greenness")
    r = earth.render(g)
    assert r.url == f"/api/layers/r_test/greenness/{scene.id}.png"
    w, s, e, n = r.bounds
    assert w < e and s < n
    png = tmp_path / "layers" / "r_test" / "greenness" / f"{scene.id}.png"
    assert png.read_bytes()[:4] == b"\x89PNG"


# --- Errors with hints ---------------------------------------------------------------------------


def test_area_too_small_has_hint():
    tiny = earth.Area.from_point(22.5, 114.0, radius_m=20)
    scene = earth.scenes(AREA, last="60d").latest_clear()
    with pytest.raises(earth.AreaTooSmall) as e:
        earth.load(tiny, scene)
    assert e.value.hint


def test_series_budget_has_hint():
    with pytest.raises(earth.BudgetExceeded) as e:
        earth.series(AREA, "greenness", years=10, every="month")
    assert e.value.hint


def test_call_budget_per_run():
    for _ in range(30):
        earth.surroundings(AREA)
    with pytest.raises(earth.BudgetExceeded):
        earth.surroundings(AREA)


# --- Call log (feeds the sandbox runner's on_call) -----------------------------------------------


def test_every_call_is_logged_with_a_summary():
    calls: list[earth.EarthCall] = []
    earth.set_listener(calls.append)
    scene = earth.scenes(AREA, last="60d").latest_clear()
    earth.measure(earth.index(earth.load(AREA, scene), "greenness"))
    assert [c.fn for c in calls] == ["scenes", "load", "index", "measure"]
    assert all(c.summary and c.ms >= 0 for c in calls)
    assert calls[-1].provenance is not None


def test_failed_calls_are_logged_too():
    calls: list[earth.EarthCall] = []
    earth.set_listener(calls.append)
    with pytest.raises(earth.BudgetExceeded):
        earth.series(AREA, "greenness", years=10)
    assert calls[-1].error == "budget_exceeded"


# --- Blocks --------------------------------------------------------------------------------------


def _all_blocks():
    scenes = earth.scenes(AREA, last="60d")
    before = earth.render(earth.index(earth.load(AREA, scenes.scenes[-1]), "greenness"))
    after = earth.render(earth.index(earth.load(AREA, scenes.latest_clear()), "greenness"))
    series = earth.series(AREA, "greenness", years=4)
    ring = earth.series(earth.surroundings(AREA), "greenness", years=4)
    comparison = earth.compare(AREA, "bare", before="2024-09-14", after="2026-09-30")
    return [
        earth.show.then_now(before, after, title="Then and now", area=AREA, primary=True),
        earth.show.timeline(
            series, title="Greenness", compare=ring, marks=[(date(2026, 9, 25), "change")]
        ),
        earth.show.scene_strip(scenes),
        earth.show.highlight(comparison, title="Where it changed", base=after),
        earth.show.stat("Area changed", comparison.changed_ha, "ha", lo=1.0, hi=2.0),
        earth.show.hypotheses(
            [
                {
                    "card_id": "pond_filling",
                    "label": "Ponds filled in",
                    "expected": {"greenness": "↓", "bare": "↑"},
                    "observed": {"greenness": "−0.45", "bare": "+0.45"},
                    "verdict": "supported",
                }
            ]
        ),
        earth.show.limits(
            "I can't see people or what happens inside buildings.",
            actions=[{"label": "Ask about changes to the land instead", "kind": "other"}],
            rule_id="no_people_tracking",
        ),
    ]


def test_show_builds_every_v1_block_type():
    blocks = _all_blocks()
    assert {b.type for b in blocks} == set(BLOCK_TYPES)
    assert len({b.id for b in blocks}) == len(blocks)


def test_blocks_round_trip_through_json():
    for b in _all_blocks():
        data = json.loads(json.dumps(b.model_dump(mode="json")))
        again = validate_block(data)
        assert again == b


def test_block_schema_rejects_unknown_type():
    with pytest.raises(ValidationError):
        BlockAdapter.validate_python({"type": "chart", "id": "b1", "title": "x"})


# --- Preset story (HANDOFF B12.2) ---------------------------------------------------------------


@pytest.mark.skipif(earth.settings.impl() != "stub", reason="preset values are stub-exact")
def test_stub_reproduces_the_hoo_hok_wai_story():
    inside = earth.series(AREA, "greenness", years=4)
    ring = earth.series(earth.surroundings(AREA), "greenness", years=4)
    early = [p.value for p in inside.points if p.date.year in (2022, 2023, 2024)]
    assert 0.38 <= sum(early) / len(early) <= 0.5
    assert inside.points[-1].value == pytest.approx(-0.013)
    assert all(0.45 <= p.value <= 0.65 for p in ring.points)  # local, not regional
