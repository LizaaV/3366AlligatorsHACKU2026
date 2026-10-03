"""Real Sentinel-2 `earth` (M1). Offline tests always run; network ones need EARTH_NETWORK_TESTS=1.

    EARTH_NETWORK_TESTS=1 uv run pytest tests/test_earth_real.py -s

Network tests read real Earth Search scenes and print the numbers they measured (-s to see them).
The disk cache lives in EARTH_DATA_DIR (default backend/data, git-ignored), so reruns are fast.
"""

from __future__ import annotations

import os
import time
from datetime import date
from types import SimpleNamespace

import numpy as np
import pytest

import earth
from earth import cache, real, settings
from earth.presets import HOO_HOK_WAI
from earth.providers import earth_search as es

network = pytest.mark.skipif(
    os.environ.get("EARTH_NETWORK_TESTS") != "1", reason="needs network: EARTH_NETWORK_TESTS=1"
)


def _item(item_id: str, dt: str, platform: str = "sentinel-2b", geometry: dict | None = None):
    geom = geometry or {
        "type": "Polygon",
        "coordinates": [[[100, 10], [130, 10], [130, 40], [100, 40], [100, 10]]],
    }
    return SimpleNamespace(
        id=item_id, properties={"datetime": dt, "platform": platform}, geometry=geom
    )


# --- offline ------------------------------------------------------------------------------------


def test_dedupe_keeps_the_reprocessed_item():
    items = [
        _item("S2A_49QHE_20211230_0_L2A", "2021-12-30T03:11:46Z"),
        _item("S2A_49QHE_20211230_1_L2A", "2021-12-30T03:11:46Z"),
        _item("S2A_50QKK_20211230_0_L2A", "2021-12-30T03:11:45Z"),
    ]
    ids = sorted(i.id for i in es._dedupe(items))
    assert ids == ["S2A_49QHE_20211230_1_L2A", "S2A_50QKK_20211230_0_L2A"]


def test_group_merges_tiles_of_one_pass_by_solar_day_and_platform():
    area = HOO_HOK_WAI
    west = {
        "type": "Polygon",
        "coordinates": [[[100, 10], [114.09, 10], [114.09, 40], [100, 40], [100, 10]]],
    }
    items = [
        _item("S2B_50QKK_20260930_0_L2A", "2026-09-30T03:11:43Z", geometry=west),  # partial cover
        _item("S2B_49QHE_20260930_0_L2A", "2026-09-30T03:11:44Z"),
        _item("S2C_49QHE_20260930_0_L2A", "2026-09-30T03:20:00Z", platform="sentinel-2c"),
        _item("S2B_49QHE_20260920_0_L2A", "2026-09-19T23:30:00Z"),  # UTC 19th, solar day 20th
    ]
    groups = es.group(items, area)
    assert [(g.date, g.platform) for g in groups] == [
        (date(2026, 9, 30), "sentinel-2c"),
        (date(2026, 9, 30), "sentinel-2b"),
        (date(2026, 9, 20), "sentinel-2b"),
    ]
    two = groups[1]
    assert two.id == "S2B_49QHE_20260930_0_L2A"  # covers the most of the area → listed first
    assert two.item_ids == ["S2B_49QHE_20260930_0_L2A", "S2B_50QKK_20260930_0_L2A"]
    assert two.satellite == "Sentinel-2B"


def test_resolution_drops_for_large_grids_and_never_truncates():
    assert es.choose_resolution(HOO_HOK_WAI) == 10
    strip = earth.Area.from_geojson(
        {
            "type": "Polygon",
            "coordinates": [
                [
                    [145.0, -37.0],
                    [145.3, -36.75],
                    [145.302, -36.752],
                    [145.002, -37.002],
                    [145.0, -37.0],
                ]
            ],
        }
    )
    res = es.choose_resolution(strip)
    assert res > 10
    h, w = es.geobox(strip, res).shape
    assert h * w <= settings.MAX_PIXELS_PER_READ


def test_area_mask_matches_the_area_and_utm_zone():
    south = earth.Area.from_point(-36.90, 145.30, radius_m=500)
    assert south.utm_epsg() == 32755
    gbox = es.geobox(south, 10)
    inside = es.area_mask(south, gbox)
    assert inside.sum() == pytest.approx(south.pixels(10), rel=0.03)
    w, s, e, n = es.wgs84_bounds(gbox)
    bw, bs, be, bn = south.bbox()
    assert w <= bw + 1e-4 and s <= bs + 1e-4 and e >= be - 1e-4 and n >= bn - 1e-4


def test_cache_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    k = cache.key("x", [1, 2])
    assert cache.get_arrays(k) is None
    cache.put_arrays(k, {"a": np.arange(4, dtype=np.float32)})
    assert cache.get_arrays(k)["a"].tolist() == [0, 1, 2, 3]
    ttl = cache.TTLCache(ttl_s=60)
    ttl.put("k", [1])
    assert ttl.get("k") == [1] and ttl.get("other") is None


def test_no_boa_offset_on_earth_search():
    # Verified on real items: pixels of every baseline ≥ 04.00 item are already on the old scale.
    item = SimpleNamespace(
        properties={"s2:processing_baseline": "04.00", "earthsearch:boa_offset_applied": False}
    )
    assert es.boa_offset(item) == 0


def test_radar_is_not_available_yet_with_a_hint():
    with pytest.raises(earth.EarthError) as e:
        real.scenes(HOO_HOK_WAI, last="60d", kind="radar")
    assert "M9b" in e.value.hint


# --- network (real Sentinel-2) --------------------------------------------------------------------


@pytest.fixture
def real_earth(monkeypatch, request):
    monkeypatch.setenv("EARTH_IMPL", "real")
    earth.set_run(f"t_{request.node.name[:40].lower()}".replace("[", "_").replace("]", ""))
    earth.set_listener(None)
    yield
    earth.set_run(None)


def _measure(area, scene, m="greenness"):
    t = time.perf_counter()
    stats = real.measure(real.index(real.load(area, scene), m))
    return stats, time.perf_counter() - t


def _first_clear(area, start, end, max_cloud=10):
    clear = [s for s in real.scenes_between(area, start, end, max_cloud) if s.usable]
    assert clear, f"no clear scene in {start}..{end}"
    return clear[0]


@network
def test_hoo_hok_wai_latest_clear_scene(real_earth):
    t = time.perf_counter()
    sl = earth.scenes(HOO_HOK_WAI, last="90d")
    t_scenes = time.perf_counter() - t
    scene = sl.latest_clear()
    assert scene.provider == "earth_search_s2" and scene.cloud_over_area <= 0.3
    t = time.perf_counter()
    layer = earth.load(HOO_HOK_WAI, scene)
    g = earth.index(layer, "greenness")
    stats = earth.measure(g)
    t_read = time.perf_counter() - t
    print(
        f"\nHHW 90d: {len(sl.scenes)} scenes, {len(sl.clear())} clear, latest {scene.id} "
        f"cloud {scene.cloud_over_area}; NDVI {stats.mean} ({stats.clean_px} px); "
        f"scenes {t_scenes:.1f}s, load+index+measure {t_read:.1f}s"
    )
    assert -0.2 <= stats.mean <= 0.9
    assert stats.clean_px > 0.5 * HOO_HOK_WAI.pixels(10)
    assert stats.provenance.scene == scene.id and stats.provenance.resolution_m == 10
    assert stats.provenance.satellite.startswith("Sentinel-2")
    values, bounds = real.layer_pixels(g.id)
    assert values.ndim == 2 and np.isfinite(values).sum() == stats.clean_px
    assert bounds[0] < bounds[2] and bounds[1] < bounds[3]
    # cached: a second read of the same scene is fast
    t = time.perf_counter()
    earth.measure(earth.index(earth.load(HOO_HOK_WAI, scene), "greenness"))
    assert time.perf_counter() - t < 2


@network
def test_hoo_hok_wai_autumn_2023_vs_2026(real_earth):
    then = _first_clear(HOO_HOK_WAI, date(2023, 11, 1), date(2023, 11, 30))
    now = _first_clear(HOO_HOK_WAI, date(2026, 6, 1), date(2026, 9, 30))
    g0, _ = _measure(HOO_HOK_WAI, then)
    g1, _ = _measure(HOO_HOK_WAI, now)
    b0, _ = _measure(HOO_HOK_WAI, then, "bare")
    b1, _ = _measure(HOO_HOK_WAI, now, "bare")
    print(
        f"\nHHW {then.id}: NDVI {g0.mean} NDBI {b0.mean} | {now.id}: NDVI {g1.mean} NDBI {b1.mean}"
    )
    for s in (g0, g1, b0, b1):
        assert -1 <= s.p10 <= s.median <= s.p90 <= 1 and s.clean_px > 0
    assert b1.mean > b0.mean  # the area got barer (measured: −0.26 → −0.11)


@network
def test_tile_edge_is_one_mosaicked_scene(real_earth):
    # Elephant Butte arm (world test set w2): straddles MGRS 13SBS / 13SCS, UTM 13N.
    area = earth.Area.from_point(33.27, -107.15, radius_m=1200)
    scenes = real.scenes_between(area, date(2026, 8, 10), date(2026, 8, 10))
    assert len(scenes) == 1, "one pass = one scene, not one per tile"
    scene = scenes[0]
    group = real._groups[scene.id]
    assert {i.id.split("_")[1] for i in group.items} == {"13SBS", "13SCS"}
    stats, secs = _measure(area, scene, "water")
    print(
        f"\nElephant Butte {scene.id} ({'+'.join(group.item_ids)}): NDWI {stats.mean} "
        f"{stats.clean_px} px cloud {stats.cloud} in {secs:.1f}s"
    )
    assert stats.clean_px > 0.9 * area.pixels(10) and stats.mean < 0  # lake bed is dry now
    # Mosaic: with 13SCS first, pixels come from both tiles and agree with 13SBS alone.
    gbox = es.geobox(area, 10)
    inside = es.area_mask(area, gbox)
    fwd = es.read(group.items, ["nir"], gbox)
    rev = es.read(list(reversed(group.items)), ["nir"], gbox)
    src = rev[es.SOURCE][inside]
    assert (src == 0).sum() > 1000 and (src == 1).sum() > 1000
    diff = np.abs(fwd["nir"] - rev["nir"])[inside]
    assert np.nanmedian(diff) < 0.005


@network
def test_southern_hemisphere_20_km2_farmland(real_earth):
    area = earth.Area.from_point(-36.90, 145.30, radius_m=2500)  # ~19.6 km², Victoria, UTM 55S
    assert area.utm_epsg() == 32755
    scene = _first_clear(area, date(2026, 8, 1), date(2026, 9, 30))
    stats, secs = _measure(area, scene)
    print(f"\nVictoria {scene.id}: NDVI {stats.mean} ({stats.clean_px} px, {secs:.1f}s)")
    assert 0.2 <= stats.mean <= 0.95 and stats.clean_px > 100_000


@network
def test_one_hectare_area(real_earth):
    area = earth.Area.from_point(-36.90, 145.30, radius_m=57)
    scene = _first_clear(area, date(2026, 8, 1), date(2026, 9, 30))
    stats, _ = _measure(area, scene)
    print(f"\n1 ha {scene.id}: NDVI {stats.mean} ({stats.clean_px} px)")
    assert 60 <= stats.clean_px <= 140 and stats.provenance.resolution_m == 10


@network
def test_large_grid_drops_resolution(real_earth):
    strip = earth.Area.from_geojson(
        {
            "type": "Polygon",
            "coordinates": [
                [
                    [145.0, -37.0],
                    [145.3, -36.75],
                    [145.302, -36.752],
                    [145.002, -37.002],
                    [145.0, -37.0],
                ]
            ],
        }
    )
    scene = _first_clear(strip, date(2026, 8, 1), date(2026, 9, 30))
    layer = real.load(strip, scene)
    stats = real.measure(real.index(layer, "greenness"))
    print(f"\nstrip {strip.area_ha:.0f} ha at {layer.resolution_m} m: NDVI {stats.mean}")
    assert layer.resolution_m == 20 and stats.provenance.resolution_m == 20
    assert stats.clean_px > 0


@network
def test_roughness_on_optical_is_wrong_scene_kind(real_earth):
    scene = _first_clear(HOO_HOK_WAI, date(2026, 8, 1), date(2026, 8, 31), max_cloud=30)
    layer = earth.load(HOO_HOK_WAI, scene)
    with pytest.raises(earth.WrongSceneKind):
        earth.index(layer, "roughness")
