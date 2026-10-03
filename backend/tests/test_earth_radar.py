"""M9b radar fallback: Sentinel-1 RTC from Planetary Computer.

Offline tests run by default; network tests need EARTH_NETWORK_TESTS=1.
"""

from __future__ import annotations

import os
import time
from datetime import UTC, date, datetime
from types import SimpleNamespace

import numpy as np
import pytest
from affine import Affine

import earth
from earth.errors import EarthError
from earth.presets import HOO_HOK_WAI
from earth.providers import planetary as P
from earth.types import Area

network = pytest.mark.skipif(
    os.environ.get("EARTH_NETWORK_TESTS") != "1",
    reason="set EARTH_NETWORK_TESTS=1 to hit real APIs",
)


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))


def _scene(d: date, state: str = "ascending", rel: int | None = 11, pols=("vv", "vh")):
    return P.RadarScene(
        id=P._scene_id("Sentinel-1A", d, state, rel),
        date=d,
        platform="Sentinel-1A",
        orbit_state=state,
        relative_orbit=rel,
        polarizations=list(pols),
        item_ids=["x"],
    )


def _item(id_: str, when: datetime, state="ascending", rel=11, platform="sentinel-1a"):
    return SimpleNamespace(
        id=id_,
        datetime=when,
        properties={"platform": platform, "sat:orbit_state": state, "sat:relative_orbit": rel},
        assets={"vv": object(), "vh": object(), "tilejson": object()},
    )


# --- offline ------------------------------------------------------------------------------------


def test_linear_to_db_and_nodata():
    lin = np.array([1.0, 0.1, 0.01, 0.0, -0.5, np.nan, P.S1_NODATA, np.inf])
    db = P.linear_to_db(lin)
    assert db[:3] == pytest.approx([0.0, -10.0, -20.0])
    assert np.isnan(db[3:]).all()


def test_smooth_is_nan_aware_and_keeps_mask():
    a = np.full((5, 5), 0.1)
    a[0, :] = np.nan
    a[2, 2] = 0.9  # speckle spike
    s = P.smooth3x3(a)
    assert np.isnan(s[0]).all()
    assert s[2, 2] == pytest.approx((0.9 + 8 * 0.1) / 9)
    assert s[4, 4] == pytest.approx(0.1)  # edge pixel averages only its valid neighbours


def test_group_items_merges_slices_and_splits_orbits():
    t = datetime(2026, 9, 28, 10, 33, tzinfo=UTC)
    items = [
        _item("a", t),
        _item("b", t.replace(minute=34)),  # same pass, next slice
        _item("c", t.replace(day=23), rel=113),
        _item("d", t.replace(day=22), state="descending", rel=18, platform="sentinel-1d"),
    ]
    scenes = P.group_items(items)
    assert [s.id for s in scenes] == [
        "S1A_20260928_asc_R011_rtc",
        "S1A_20260923_asc_R113_rtc",
        "S1D_20260922_des_R018_rtc",
    ]
    assert scenes[0].item_ids == ["a", "b"]
    assert scenes[2].platform == "Sentinel-1D"
    assert scenes[0].polarizations == ["vv", "vh"]
    assert scenes[0].to_scene().kind == "radar"


def test_same_orbit_never_mixes_directions():
    scenes = [
        _scene(date(2026, 9, 28)),
        _scene(date(2026, 9, 16)),
        _scene(date(2026, 9, 22), "descending", 18),
        _scene(date(2026, 9, 23), "ascending", 113),
    ]
    asc = P.same_orbit(scenes)  # most common wins
    assert {s.orbit_state for s in asc} == {"ascending"} and len(asc) == 3
    assert asc[0].date == date(2026, 9, 28)  # newest first
    assert [s.relative_orbit for s in P.same_orbit(scenes, relative_orbit=113)] == [113]
    des = P.same_orbit(scenes, "descending")
    assert [s.relative_orbit for s in des] == [18]
    assert P.same_orbit([]) == []


def test_resolve_scene_unknown_raises(monkeypatch):
    monkeypatch.setattr(P, "search_s1", lambda *a, **k: [])
    sc = _scene(date(2026, 9, 28)).to_scene()
    P._REGISTRY.pop(sc.id, None)
    with pytest.raises(EarthError):
        P.resolve_scene(HOO_HOK_WAI, sc)


def _fake_read(monkeypatch, values: np.ndarray):
    """Make read_s1 run end to end on a synthetic linear-power grid, no network."""
    area = Area.from_point(22.5340, 114.0906, radius_m=100)
    sc = _scene(date(2026, 9, 28))
    monkeypatch.setattr(P, "_items_by_id", lambda ids: ["item"])
    from pyproj import Transformer

    cx, cy = Transformer.from_crs("EPSG:4326", f"EPSG:{area.utm_epsg()}", always_xy=True).transform(
        114.0906, 22.5340
    )
    n = values.shape[0]
    tr = Affine(10, 0, cx - 5 * n, 0, -10, cy + 5 * n)
    monkeypatch.setattr(P, "_load", lambda *a, **k: (values.astype("float32"), tr))
    return area, sc


def test_read_s1_masks_polygon_converts_db_and_caches(monkeypatch):
    lin = np.full((40, 40), 0.1)  # -10 dB everywhere
    lin[20, 20] = P.S1_NODATA  # a nodata hole inside the polygon
    area, sc = _fake_read(monkeypatch, lin)
    db, tr = P.read_s1(area, sc, "vv", smooth=False)
    assert db.shape == lin.shape
    assert np.isnan(db[0, 0]) and np.isnan(db[39, 39])  # outside the 100 m circle
    assert np.isnan(db[20, 20])
    inside = db[np.isfinite(db)]
    assert 200 < inside.size < 330 and inside == pytest.approx(-10.0)
    # second call is served from disk: the loader must not run again
    monkeypatch.setattr(P, "_load", lambda *a, **k: pytest.fail("not cached"))
    db2, tr2 = P.read_s1(area, sc, "vv", smooth=False)
    assert np.array_equal(np.isnan(db), np.isnan(db2)) and tr2 == tr
    west, south, east, north = P.grid_bounds(area, db.shape, tr)
    assert west < 114.0906 < east and south < 22.5340 < north


def test_roughness_stats_and_provenance(monkeypatch):
    rng = np.random.default_rng(0)
    lin = 10 ** (rng.normal(-9, 1.0, (40, 40)) / 10)
    area, sc = _fake_read(monkeypatch, lin)
    st = P.roughness_stats(area, sc, "vh")
    assert -9.6 < st.mean < -8.4 and st.p10 < st.median < st.p90
    assert st.cloud == 0.0 and st.clean_px > 200
    p = st.provenance
    assert p.provider == "planetary_s1_rtc" and p.satellite == "Sentinel-1A"
    assert p.scene == sc.id and p.date == sc.date and p.resolution_m == 10
    assert p.method.startswith("Mean VH backscatter (dB), RTC gamma0, ascending orbit")
    assert f"over {st.clean_px} pixels" in p.method


def test_missing_polarization_has_hint():
    sc = _scene(date(2026, 9, 28), pols=("vv",))
    with pytest.raises(EarthError) as e:
        P.read_s1(HOO_HOK_WAI, sc, "vh")
    assert e.value.hint and "vv" in e.value.hint


def test_read_timeout_becomes_hinted_error(monkeypatch):
    with pytest.raises(EarthError) as e:
        P._within(0.05, time.sleep, 1)
    assert "try again" in (e.value.hint or "").lower()


# --- network ------------------------------------------------------------------------------------
@network
def test_hoo_hok_wai_radar_same_orbit():
    area = HOO_HOK_WAI
    scenes = P.search_s1(area, date(2026, 1, 1), date(2026, 10, 3))
    assert any(date(2026, 8, 1) <= s.date <= date(2026, 9, 30) for s in scenes)
    assert {s.orbit_state for s in scenes} == {"ascending"}  # only one direction over this area
    track = P.same_orbit(scenes, relative_orbit=11)
    after = next(s for s in track if s.date >= date(2026, 9, 20))
    before = next(s for s in track if s.date <= date(2026, 2, 28))
    ring = earth.surroundings(area)
    t0 = time.time()
    a = P.roughness_stats(area, after)
    cold = time.time() - t0
    t0 = time.time()
    P.roughness_stats(area, after)  # warm: from disk cache
    assert time.time() - t0 < 1.0 and time.time() - t0 < cold
    b = P.roughness_stats(area, before)
    ra, rb = P.roughness_stats(ring, after), P.roughness_stats(ring, before)
    # Measured 2026-10-03: ponds about -11.6 dB VV in both windows (water is dark, no >3 dB step),
    # surroundings about -7.8 dB. Check geometry and stability, not HANDOFF B12.2's story.
    assert a.mean < ra.mean - 2 and b.mean < rb.mean - 2  # ponds darker than the land around
    assert abs(a.mean - b.mean) < 3 and abs(ra.mean - rb.mean) < 3  # same orbit: stable
    assert -14 < a.mean < -8 and -10 < ra.mean < -5
    assert a.provenance.method.count("ascending") == 1


@network
def test_merauke_radar_scenes_exist_where_optical_is_cloudy():
    area = Area.from_point(-7.4875, 139.1125, radius_m=1000, name="Merauke")
    before = P.search_s1(area, date(2023, 6, 1), date(2023, 9, 30))
    after = P.search_s1(area, date(2025, 5, 1), date(2025, 10, 31))
    # Sentinel-2 has only 2 scenes under 30% tile cloud in the same 2025 window; radar has dozens.
    assert len(before) >= 10 and len(after) >= 20
    rel = 53
    b_scene = P.same_orbit(before, "ascending", rel)[0]
    a_scene = P.same_orbit(after, "ascending", rel)[0]
    vb, va = P.roughness_stats(area, b_scene, "vh"), P.roughness_stats(area, a_scene, "vh")
    assert -20 < vb.mean < -8 and -20 < va.mean < -8
    assert vb.provenance.provider == "planetary_s1_rtc" and va.cloud == 0.0
