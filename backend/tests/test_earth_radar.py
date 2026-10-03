"""M9b radar fallback: Sentinel-1 RTC from Planetary Computer.

Offline tests run by default; network tests need EARTH_NETWORK_TESTS=1.
"""

from __future__ import annotations

import os
import time
from datetime import UTC, date, datetime, timedelta
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


# --- offline: radar wired into earth.real (scenes / load / index / measure / series / compare) ----


def test_radar_pair_never_mixes_directions_and_prefers_one_track():
    from earth import real

    near_b = [
        _scene(date(2026, 3, 1), "descending", 18),  # closest to `before`, wrong direction later
        _scene(date(2026, 3, 3)),  # ascending R011
        _scene(date(2026, 3, 2), "ascending", 113),
    ]
    near_a = [_scene(date(2026, 9, 28)), _scene(date(2026, 9, 27), "ascending", 113)]
    sb, sa = real.radar_pair(near_b, near_a, date(2026, 3, 1), date(2026, 9, 28))
    assert sb.orbit_state == sa.orbit_state == "ascending"
    assert sb.relative_orbit == sa.relative_orbit
    # only the opposite direction after: no pair at all
    only_des = [_scene(date(2026, 9, 28), "descending", 18)]
    assert (
        real.radar_pair([_scene(date(2026, 3, 3))], only_des, date(2026, 3, 1), date(2026, 9, 28))
        is None
    )
    # same direction, different tracks: allowed when no same-track pair exists
    sb, sa = real.radar_pair(
        [_scene(date(2026, 3, 3))], [_scene(date(2026, 9, 27), "ascending", 113)],
        date(2026, 3, 1), date(2026, 9, 28),
    )  # fmt: skip
    assert (sb.relative_orbit, sa.relative_orbit) == (11, 113)


_SMALL = Area.from_point(22.5340, 114.0906, radius_m=100)


def _fake_radar(monkeypatch, scenes: list, db_for):
    """search_s1 → `scenes` (inside the window); read_s1 → db_for(scene) on a fixed 40×40 grid."""
    from pyproj import Transformer

    cx, cy = Transformer.from_crs(
        "EPSG:4326", f"EPSG:{_SMALL.utm_epsg()}", always_xy=True
    ).transform(114.0906, 22.5340)
    tr = Affine(10, 0, cx - 200, 0, -10, cy + 200)
    mask = P._polygon_mask(_SMALL, (40, 40), tr)
    for s in scenes:
        P._REGISTRY[s.id] = s

    def search(area, start, end):
        return sorted(
            (s for s in scenes if start <= s.date <= end), key=lambda s: s.date, reverse=True
        )

    def read(area, scene, pol="vv", resolution_m=10, smooth=True):
        sc = P.resolve_scene(area, scene)
        return np.where(mask, db_for(sc), np.nan), tr

    monkeypatch.setattr(P, "search_s1", search)
    monkeypatch.setattr(P, "read_s1", read)
    return mask


def test_real_radar_scene_load_index_measure_render(monkeypatch):
    from earth import real

    today = date.today()
    sc = _scene(today)
    _fake_radar(monkeypatch, [sc], lambda s: -11.5)
    sl = real.scenes(_SMALL, last="60d", kind="radar")
    assert sl.kind == "radar" and [s.id for s in sl.scenes] == [sc.id]
    assert sl.latest_clear().provider == P.S1_PROVIDER and sl.latest_clear().cloud_over_area == 0
    raw = real.load(_SMALL, sl.latest_clear())
    assert raw.measure is None and raw.provenance.provider == P.S1_PROVIDER
    with pytest.raises(earth.WrongSceneKind) as e:
        real.index(raw, "greenness")
    assert "needs an optical scene" in e.value.message and 'kind="optical"' in e.value.hint
    with pytest.raises(earth.NoClearScenes) as e:
        real.measure(raw)
    assert "roughness" in e.value.hint
    r = real.index(raw, "roughness")
    st = real.measure(r)
    assert st.mean == pytest.approx(-11.5) and st.cloud == 0.0 and st.clean_px > 200
    assert "VV" in st.provenance.method and "ascending orbit" in st.provenance.method
    values, (w, s_, e_, n) = real.layer_pixels(r.id)
    assert values.shape == (40, 40) and w < 114.0906 < e_ and s_ < 22.534 < n
    # the M1 record fields are still there for other readers of real._layers
    rec = real._layers[r.id]
    assert rec.items == [] and rec.tiles == {} and rec.gbox.shape == (40, 40)


def test_real_radar_compare_same_orbit_and_3db_patches(monkeypatch):
    from earth import real

    b, a = date(2026, 3, 1), date(2026, 9, 28)
    s_before, s_after = _scene(date(2026, 3, 3)), _scene(date(2026, 9, 26))
    decoy = _scene(date(2026, 9, 28), "descending", 18)  # closer to `after`, other direction
    after_db = np.full((40, 40), -8.0)
    after_db[5:35, 5:20] = -14.0  # 6 dB darker (flooded) over the west half

    _fake_radar(
        monkeypatch, [s_before, s_after, decoy], lambda s: -8.0 if s is s_before else after_db
    )
    c = real.compare(_SMALL, "roughness", b, a)
    assert c.before.provenance.scene == s_before.id and c.after.provenance.scene == s_after.id
    assert c.delta < -1 and c.patches and 0 < c.changed_ha <= _SMALL.area_ha
    assert "same ascending orbit" in c.provenance.method and "3 dB" in c.provenance.method


def test_real_radar_compare_without_same_direction_is_hinted_error(monkeypatch):
    from earth import real

    _fake_radar(
        monkeypatch,
        [_scene(date(2026, 3, 3)), _scene(date(2026, 9, 27), "descending", 18)],
        lambda s: -9.0,
    )
    with pytest.raises(EarthError) as e:
        real.compare(_SMALL, "roughness", date(2026, 3, 1), date(2026, 9, 28))
    assert not isinstance(e.value, earth.NoClearScenes)
    assert "same orbit direction" in e.value.message and 'kind="radar"' in e.value.hint


def test_real_radar_series_uses_one_orbit_direction(monkeypatch):
    from earth import real

    today = date.today()
    asc = [_scene(today - timedelta(days=12 * k)) for k in range(31)]  # ~1 year, R011
    des = [_scene(today - timedelta(days=12 * k + 5), "descending", 18) for k in range(5)]
    _fake_radar(monkeypatch, asc + des, lambda s: -10.0 if s.orbit_state == "ascending" else -2.0)
    s = real.series(_SMALL, "roughness", years=1)
    assert s.measure == "roughness" and len(s.points) >= 11
    assert all(p.value == pytest.approx(-10.0) for p in s.points)  # never the descending passes
    assert all("_asc_" in p.scene for p in s.points)
    assert s.provenance.method.startswith("VV dB, ascending orbit")
    assert s.provenance.provider == P.S1_PROVIDER


def test_describe_warning_points_cloudy_places_to_radar():
    from earth import real

    out = real._describe_warnings(HOO_HOK_WAI, {}, (5, 0), 9)
    assert any('kind="radar"' in w and "9 Sentinel-1" in w for w in out)


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


@network
def test_public_api_radar_on_hoo_hok_wai(monkeypatch):
    """scenes(kind="radar") → load → index → measure → render, and a same-orbit compare."""
    monkeypatch.setenv("EARTH_IMPL", "real")
    earth.set_run("t_radar_public")
    area = HOO_HOK_WAI
    sc = earth.scenes(area, last="60d", kind="radar").latest_clear()
    r = earth.index(earth.load(area, sc), "roughness")
    st = earth.measure(r)
    assert -14 < st.mean < -9 and st.cloud == 0.0  # measured 2026-10-03: -11.64 dB on 28 Sep
    png = earth.render(r)
    assert png.measure == "roughness" and png.bounds[0] < 114.09 < png.bounds[2]
    # Measured: -11.59 (17 Feb, R011) → -11.64 (28 Sep, R011): ponds stay dark water.
    c = earth.compare(area, "roughness", date(2026, 2, 15), date(2026, 9, 28))
    assert abs(c.delta) < 3 and "same ascending orbit" in c.provenance.method
