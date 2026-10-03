"""Real `earth` analysis (M2): describe, series, compare.

Offline tests always run. Network ones read real Sentinel-2 and need EARTH_NETWORK_TESTS=1:

    EARTH_NETWORK_TESTS=1 uv run pytest tests/test_earth_analysis.py -s
"""

from __future__ import annotations

import os
import time
from datetime import date
from types import SimpleNamespace

import numpy as np
import pytest
from affine import Affine

import earth
from earth import real, settings
from earth.presets import HOO_HOK_WAI
from earth.types import Scene, SeriesPoint

network = pytest.mark.skipif(
    os.environ.get("EARTH_NETWORK_TESTS") != "1", reason="needs network: EARTH_NETWORK_TESTS=1"
)


# --- offline: index maths --------------------------------------------------------------------


def test_index_mean_uses_only_valid_finite_pixels():
    a = np.array([[0.5, 0.3], [0.0, 0.9]], np.float32)
    b = np.array([[0.1, 0.1], [0.0, np.nan]], np.float32)
    valid = np.array([[True, False], [True, True]])
    value, n = real.index_mean(a, b, valid)
    assert n == 1  # (0,1) masked, (1,0) is 0/0, (1,1) is NaN
    assert value == pytest.approx((0.5 - 0.1) / 0.6)


# --- offline: series periods, clearest per period, normal band --------------------------------


def test_periods_are_calendar_months_ending_today():
    p = real._periods(date(2026, 10, 3), 1, "month")
    assert len(p) == 12
    assert p[0] == (date(2025, 11, 1), date(2025, 11, 30))
    assert p[-1] == (date(2026, 10, 1), date(2026, 10, 3))
    q = real._periods(date(2026, 10, 3), 2, "quarter")
    assert len(q) == 8 and q[-1][0] == date(2026, 10, 1) and q[0][0] == date(2025, 1, 1)


def test_periods_over_budget_raise_with_hint():
    with pytest.raises(earth.BudgetExceeded) as e:
        real._periods(date(2026, 10, 3), 10, "month")
    assert "quarter" in (e.value.hint or "")


def _pick(day: int, cloud: float, clean: int = 500):
    g = SimpleNamespace(id=f"S2B_49QHE_202609{day:02d}_0_L2A", date=date(2026, 9, day))
    return real._Pick(g, cloud, clean, np.ones((1, 1), bool))  # type: ignore[arg-type]


def test_pick_clearest_skips_cloudy_and_tiny_scenes():
    assert real.pick_clearest([_pick(1, 0.5), _pick(6, 0.31)]) is None
    best = real.pick_clearest([_pick(1, 0.2), _pick(6, 0.05), _pick(11, 0.0, clean=3)])
    assert best is not None and best.group.date == date(2026, 9, 6)


def test_bucket_orders_candidates_by_tile_cloud():
    def g(day: int, cc: float):
        item = SimpleNamespace(properties={"eo:cloud_cover": cc})
        return SimpleNamespace(id=str(day), date=date(2026, 9, day), items=[item])

    periods = [(date(2026, 8, 1), date(2026, 8, 31)), (date(2026, 9, 1), date(2026, 9, 30))]
    out = real._bucket([g(1, 80), g(6, 5), g(11, 40)], periods)
    assert out[0] == []
    assert [x.id for x in out[1]] == ["6", "11", "1"]


def test_search_long_covers_the_window_in_contiguous_chunks(monkeypatch, tmp_path):
    from earth.providers import earth_search as es

    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    calls = []

    def fake_search(area, start, end):
        calls.append((start, end))
        return [
            SimpleNamespace(
                id=f"S2B_49QHE_{start:%Y%m%d}_0_L2A", properties={"datetime": str(start)}
            )
        ]

    monkeypatch.setattr(es, "search", fake_search)
    monkeypatch.setattr(es, "_search_settled", lambda area, s, e: fake_search(area, s, e))
    items = es.search_long(HOO_HOK_WAI, date(2021, 10, 1), date(2026, 10, 3))
    calls.sort()
    assert calls[0][0] == date(2021, 10, 1) and calls[-1][1] == date(2026, 10, 3)
    assert all((b[0] - a[1]).days == 1 for a, b in zip(calls, calls[1:], strict=False))
    assert len(items) == len(calls)


def test_normal_band_uses_earlier_years_only_and_needs_two():
    def pt(y: int, m: int, v: float) -> SeriesPoint:
        return SeriesPoint(date=date(y, m, 10), value=v, scene="S", clean_px=100)

    points = [pt(2023, 3, 0.4), pt(2024, 3, 0.5), pt(2023, 4, 0.6), pt(2026, 3, -0.1)]
    band = real.normal_band(points, cutoff=date(2025, 10, 3))
    assert len(band) == 1  # April has one year only; 2026 is after the cutoff
    b = band[0]
    assert (b.month, b.lo, b.hi, b.mean) == (3, 0.4, 0.5, 0.45)


# --- offline: compare scene choice and patches ------------------------------------------------


def _scene(day: int, cloud: float, usable: bool = True) -> Scene:
    return Scene(
        id=f"S2B_49QHE_202609{day:02d}_0_L2A",
        date=date(2026, 9, day),
        satellite="Sentinel-2B",
        provider="earth_search_s2",
        kind="optical",
        cloud_over_area=cloud,
        usable=usable,
        resolution_m=20,
    )


def test_closest_clear_prefers_a_clear_scene_over_a_closer_cloudy_one():
    d = date(2026, 9, 15)
    found = [_scene(15, 0.25), _scene(20, 0.02), _scene(25, 0.0), _scene(14, 0.9, usable=False)]
    assert real.closest_clear(found, d).date == date(2026, 9, 20)
    assert real.closest_clear([_scene(15, 0.25), _scene(5, 0.2)], d).date == date(2026, 9, 15)
    assert real.closest_clear([_scene(14, 0.9, usable=False)], d) is None


def test_majority_filter_drops_speckle_keeps_blocks():
    m = np.zeros((12, 12), bool)
    m[2:8, 2:8] = True  # 36 px block
    m[10, 10] = True  # lone pixel
    out = real.majority3(m)
    assert not out[10, 10]
    assert out[3:7, 3:7].all()


def _gbox(res: float = 10.0):
    # UTM 50N grid near Hong Kong; only .crs and .transform are used by change_patches
    return SimpleNamespace(crs="EPSG:32650", transform=Affine(res, 0, 200_000, 0, -res, 2_500_000))


def test_change_patches_finds_the_block_in_the_direction_of_change():
    diff = np.zeros((40, 40), np.float32)
    diff[5:15, 5:25] = -0.4  # 200 px at 10 m = 2 ha, greenness drop
    diff[30:33, 30:33] = +0.5  # opposite direction: ignored
    diff[0, 39] = -0.9  # speckle: dropped
    diff[20, :] = np.nan  # masked row
    patches, ha = real.change_patches(diff, delta=-0.1, threshold=0.15, gbox=_gbox())
    assert len(patches) == 1
    p = patches[0]
    assert p.ha == pytest.approx(2.0, abs=0.05) and ha == pytest.approx(p.ha)
    lat, lon = p.centroid
    assert 22 < lat < 23 and 113 < lon < 115
    assert p.geojson["type"] == "Polygon"


def test_change_patches_drops_small_patches_and_sorts_largest_first():
    diff = np.zeros((60, 60), np.float32)
    diff[2:5, 2:5] = 0.3  # 9 px = 0.09 ha: below MIN_PATCH_HA
    diff[10:20, 10:20] = 0.3  # 1 ha
    diff[30:50, 30:50] = 0.3  # 4 ha
    patches, ha = real.change_patches(diff, delta=0.2, threshold=0.15, gbox=_gbox())
    assert [round(p.ha) for p in patches] == [4, 1]
    assert ha == pytest.approx(5.0, abs=0.1)


def test_change_patches_none_when_nothing_moves():
    patches, ha = real.change_patches(np.zeros((10, 10)), 0.0, 0.15, _gbox())
    assert patches == [] and ha == 0.0


def test_thresholds_cover_every_optical_measure():
    assert set(settings.CHANGE_THRESHOLDS) == set(real.INDICES)


def test_radar_measures_raise_the_hinted_error():
    with pytest.raises(earth.EarthError) as e:
        real.series(HOO_HOK_WAI, "roughness")
    assert "radar" in (e.value.hint or "").lower() or "optical" in (e.value.hint or "")
    with pytest.raises(earth.EarthError):
        real.compare(HOO_HOK_WAI, "roughness", date(2025, 1, 1), date(2026, 1, 1))


# --- network: the preset and world places -----------------------------------------------------


@network
def test_describe_real_counts_scenes():
    t = time.monotonic()
    ctx = real.describe(HOO_HOK_WAI)
    print(f"\ndescribe {time.monotonic() - t:.1f}s {ctx.recent_scenes} {ctx.warnings}")
    assert ctx.recent_scenes.optical > 0
    assert ctx.recent_scenes.clear <= ctx.recent_scenes.optical
    assert ctx.pixels_10m == HOO_HOK_WAI.pixels(10)


@network
def test_preset_series_has_points_band_and_real_scene_ids():
    t = time.monotonic()
    s = real.series(HOO_HOK_WAI, "greenness", years=5)
    print(f"\nseries 5y {time.monotonic() - t:.1f}s, {len(s.points)} points, {len(s.band)} months")
    for p in s.points:
        print(f"  {p.date} {p.value:+.3f} {p.clean_px:5d} {p.scene}")
    assert len(s.points) >= 24
    assert [p.date for p in s.points] == sorted(p.date for p in s.points)
    assert all(p.scene.startswith("S2") and p.clean_px >= settings.MIN_CLEAN_PX for p in s.points)
    assert all(b.lo <= b.mean <= b.hi for b in s.band)
    assert s.provenance.scene == f"{len(s.points)} scenes"


@network
def test_preset_compare_is_local_not_regional():
    """Loose on purpose: the preset outline will be redrawn. Inside vs ring, late 2022 → late 2025.

    Inside the current circle M1 measured NDBI −0.27 → −0.10; the ring must stay comparatively
    stable (|Δ| smaller than inside).
    """
    before, after = date(2022, 11, 20), date(2025, 11, 21)
    inside = real.compare(HOO_HOK_WAI, "bare", before, after)
    ring = real.compare(earth.surroundings(HOO_HOK_WAI), "bare", before, after)
    print(f"\nbare inside {inside.delta:+.3f} ({inside.changed_ha} ha), ring {ring.delta:+.3f}")
    assert inside.delta > 0.02
    assert inside.changed_ha > 0 and inside.patches
    assert inside.changed_ha <= HOO_HOK_WAI.area_ha
    assert abs(ring.delta) < abs(inside.delta)


WORLD = [  # (name, lat, lon, radius_m, before, after, measure, sign)
    ("elephant-butte", 33.27, -107.15, 1200, date(2023, 7, 27), date(2026, 8, 10), "water", -1),
    ("longwood-fire", -36.946, 145.497, 2500, date(2025, 12, 17), date(2026, 1, 24), "burn", -1),
    ("cyprus-fields", 35.10, 33.50, 800, date(2025, 3, 15), date(2026, 3, 8), "greenness", +1),
]


@network
@pytest.mark.parametrize("place", WORLD, ids=lambda p: p[0])
def test_world_places_compare_in_the_documented_direction(place):
    name, lat, lon, r, before, after, measure, sign = place
    area = earth.Area.from_point(lat, lon, radius_m=r, name=name)
    t = time.monotonic()
    c = real.compare(area, measure, before, after)
    print(
        f"\n{name} {measure} {c.before.mean:+.3f} → {c.after.mean:+.3f} ({c.delta:+.3f}), "
        f"{c.changed_ha} ha in {len(c.patches)} patches, {time.monotonic() - t:.1f}s"
    )
    assert c.delta * sign > 0.02
    assert c.changed_ha > 0
    assert c.patches == sorted(c.patches, key=lambda p: -p.ha)
