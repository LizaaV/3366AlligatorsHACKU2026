"""M9c: Landsat surface heat (measure "heat", kind "thermal") and NASA FIRMS active fire.

Offline tests run by default; network tests need EARTH_NETWORK_TESTS=1 (fires also FIRMS_MAP_KEY).
"""

from __future__ import annotations

import asyncio
import os
import urllib.error
from datetime import date, datetime, timezone
from types import SimpleNamespace

import numpy as np
import pytest

import earth
from earth import settings
from earth.errors import EarthError, WrongSceneKind
from earth.presets import HOO_HOK_WAI
from earth.providers import firms
from earth.providers import planetary as P
from earth.types import Area

network = pytest.mark.skipif(
    os.environ.get("EARTH_NETWORK_TESTS") != "1",
    reason="set EARTH_NETWORK_TESTS=1 to hit real APIs",
)


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    earth.set_run(None)  # reset the per-run call budget
    if os.environ.get("EARTH_NETWORK_TESTS") != "1":
        monkeypatch.setenv("EARTH_IMPL", "stub")
        monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))


@pytest.fixture
def area() -> Area:
    return Area.from_point(22.534, 114.09, radius_m=350, name="Hoo Hok Wai")


# --- pure maths ---------------------------------------------------------------------------------


def test_scale_and_offset_give_celsius():
    dn = (313.15 - 149.0) / 0.00341802  # 40.0 °C
    out = P.st_to_celsius(np.array([dn, 0, 1.0, 65535.0]))
    assert out[0] == pytest.approx(40.0, abs=0.01)
    assert np.isnan(out[1])  # DN 0 = no data
    assert np.isnan(out[2])  # -124 °C: retrieval error
    assert np.isnan(out[3])  # 99.8 °C is outside the valid range


def test_qa_bits_mask_cloud_shadow_cirrus_dilated_and_fill():
    qa = np.array(
        [
            1,  # fill
            1 << 1,  # dilated cloud
            1 << 2,  # cirrus
            1 << 3,  # cloud
            1 << 4,  # cloud shadow
            1 << 5,  # snow: kept
            (1 << 6) | (1 << 7),  # clear + water: kept
            (1 << 6) | (3 << 8),  # clear, high cloud confidence bits only: kept
            21824,  # typical clear land pixel
        ]
    )
    assert P.qa_bad(qa).tolist() == [True, True, True, True, True, False, False, False, False]


def _item(id_, when, path=121, platform="landsat-8", cloud=10.0, assets=("lwir11", "qa_pixel")):
    return SimpleNamespace(
        id=id_,
        datetime=when,
        properties={"platform": platform, "landsat:wrs_path": path, "eo:cloud_cover": cloud},
        assets={a: object() for a in assets},
    )


def test_group_landsat_merges_rows_of_one_pass():
    t = datetime(2026, 4, 16, 2, 45, tzinfo=timezone.utc)  # noqa: UP017
    items = [
        _item("LC08_121045", t, cloud=8.07),
        _item("LC08_121044", t, cloud=32.29),
        _item("LC09_122044", datetime(2026, 4, 15, 2, 51, tzinfo=timezone.utc), 122, "landsat-9"),  # noqa: UP017
        _item("LC08_x", t, assets=("red",)),  # no thermal asset: ignored
    ]
    got = P.group_landsat(items)
    assert [s.id for s in got] == ["L8_121_20260416_st", "L9_122_20260415_st"]
    assert got[0].item_ids == ["LC08_121044", "LC08_121045"]
    assert got[0].tile_cloud == 0.0807
    assert got[0].platform == "Landsat 8"
    assert got[0].to_scene().kind == "thermal"


def test_group_landsat_drops_tier_2_scenes():
    t = datetime(2026, 9, 6, 2, 45, tzinfo=timezone.utc)  # noqa: UP017
    it = _item("LC09_T2", t, 122, "landsat-9")
    it.properties["landsat:collection_category"] = "T2"
    assert P.group_landsat([it]) == []


# --- stub heat ----------------------------------------------------------------------------------


def test_stub_heat_inside_warmer_than_ring_by_about_5(area):
    d = date(2026, 4, 16)
    inside = earth.measure(
        earth.index(earth.load(area, earth.scenes(area, kind="thermal").scenes[0]), "heat")
    )
    assert 30 < inside.mean < 45
    sc = [s for s in earth.scenes(area, last="1y", kind="thermal").scenes if s.usable][0]
    ring = earth.surroundings(area)
    a = earth.measure(earth.index(earth.load(area, sc), "heat")).mean
    b = earth.measure(earth.index(earth.load(ring, sc), "heat")).mean
    assert 3 < a - b < 8
    assert d  # B12.2 date lives in the network test


def test_stub_thermal_series_compare_and_render(area):
    s = earth.series(area, "heat", years=2, every="quarter")
    assert s.measure == "heat" and len(s.points) == 8
    c = earth.compare(area, "heat", before="2025-01-10", after="2026-09-20")
    assert c.measure == "heat" and c.after.mean > c.before.mean
    scene = earth.scenes(area, kind="thermal").latest_clear()
    r = earth.render(earth.index(earth.load(area, scene), "heat"))
    assert r.measure == "heat" and r.url.endswith(".png")


def test_heat_ramp_is_blue_to_red():
    from earth.render import colourise

    rgba = colourise(np.array([[10.0, 30.0, 50.0, np.nan]]), "heat")
    assert rgba[0, 0, 2] > rgba[0, 0, 0]  # cold = blue
    assert rgba[0, 2, 0] > rgba[0, 2, 2]  # hot = red
    assert rgba[0, 3, 3] == 0


def test_heat_only_on_thermal_scenes(area):
    optical = earth.load(area, earth.scenes(area).latest_clear())
    with pytest.raises(WrongSceneKind) as e:
        earth.index(optical, "heat")
    assert 'kind="thermal"' in (e.value.hint or "")
    thermal = earth.load(area, earth.scenes(area, kind="thermal").latest_clear())
    with pytest.raises(WrongSceneKind) as e2:
        earth.index(thermal, "greenness")
    assert 'kind="optical"' in (e2.value.hint or "")


def test_thermal_kind_and_heat_measure_are_known(area):
    with pytest.raises(EarthError):
        earth.scenes(area, kind="infrared")  # type: ignore[arg-type]
    assert "heat" in earth.Measure.__args__  # type: ignore[attr-defined]


# --- fires --------------------------------------------------------------------------------------


def test_stub_fires(area):
    f = earth.fires(area, last="30d", radius_km=10)
    assert f.total == 3 and f.inside == 1
    assert f.detections[0].km_from_area == 0
    assert f.provenance.provider == "nasa_firms_viirs_nrt"
    near = earth.fires(area, last="30d", radius_km=1)
    assert near.total == 1


def test_fires_validates_arguments(area):
    with pytest.raises(EarthError):
        earth.fires(area, last="soon")
    with pytest.raises(EarthError):
        earth.fires(area, radius_km=-1)


def test_fires_without_key_is_a_hinted_error_not_a_crash(area, monkeypatch):
    monkeypatch.setenv("EARTH_IMPL", "real")
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    with pytest.raises(EarthError) as e:
        earth.fires(area)
    assert e.value.hint == "fire data needs FIRMS_MAP_KEY on the server"


CSV = (
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,"
    "confidence,version,bright_ti5,frp,daynight\n"
    "22.5340,114.0900,330.1,0.4,0.4,2026-09-28,0512,N,VIIRS,n,2.0NRT,300.1,4.2,D\n"
    "22.5340,114.0900,330.1,0.4,0.4,2026-09-28,0512,N,VIIRS,n,2.0NRT,300.1,4.2,D\n"  # duplicate
    "22.5700,114.0900,320.0,0.4,0.4,2026-09-20,0630,1,VIIRS,h,2.0NRT,300.1,9.9,D\n"  # ~4 km
    "22.9000,114.0900,320.0,0.4,0.4,2026-09-21,0630,1,VIIRS,l,2.0NRT,300.1,1.0,N\n"  # ~40 km
)


def test_build_filters_sorts_dedupes_and_converts_confidence(area):
    f = firms.build(area, firms.parse_csv(CSV), "30d", 10)
    assert f.total == 2 and f.inside == 1
    assert [d.confidence for d in f.detections] == ["nominal", "high"]
    assert f.detections[0].km_from_area == 0 and 3 < f.detections[1].km_from_area < 5
    assert f.detections[1].frp == 9.9


def test_build_caps_detections(area, monkeypatch):
    monkeypatch.setattr(settings, "FIRMS_MAX_DETECTIONS", 2)
    rows = [
        {"latitude": "22.534", "longitude": f"114.{i:03d}", "acq_date": "2026-09-28"}
        for i in range(5)
    ]
    f = firms.build(area, rows, "30d", 50)
    assert f.total == 5 and len(f.detections) == 2


def test_parse_csv_rejects_non_csv_and_accepts_empty():
    assert firms.parse_csv("") == []
    assert firms.parse_csv(CSV.split("\n")[0] + "\n") == []
    with pytest.raises(EarthError):
        firms.parse_csv("Invalid MAP_KEY.")


def test_key_never_leaks_into_errors_or_provenance(area, monkeypatch):
    secret = "SECRETKEY123456"
    monkeypatch.setenv("EARTH_IMPL", "real")
    monkeypatch.setenv("FIRMS_MAP_KEY", secret)

    def boom(req, timeout=0):
        raise urllib.error.HTTPError(req.full_url, 403, "no", {}, None)  # type: ignore[arg-type]

    monkeypatch.setattr(firms.urllib.request, "urlopen", boom)
    with pytest.raises(EarthError) as e:
        earth.fires(area)
    assert secret not in str(e.value) and secret not in repr(e.value.__dict__)

    monkeypatch.setattr(firms, "_fetch", lambda *a, **k: CSV)
    f = earth.fires(area, last="5d")
    assert secret not in f.model_dump_json()


def test_long_windows_are_chunked_and_capped(area, monkeypatch):
    monkeypatch.setenv("EARTH_IMPL", "real")
    monkeypatch.setenv("FIRMS_MAP_KEY", "k")
    calls = []

    def fake(key, source, box, days, start):
        calls.append((source, days, start))
        return CSV.split("\n")[0] + "\n"

    monkeypatch.setattr(firms, "_fetch", fake)
    earth.fires(area, last="30d")
    assert len(calls) == 6 and {c[1] for c in calls} == {10}
    with pytest.raises(EarthError):
        earth.fires(area, last="1y")


# --- sandbox ------------------------------------------------------------------------------------

SCRIPT = """
import earth

def run(**params):
    area = earth.presets.HOO_HOK_WAI
    s = earth.scenes(area, last="60d", kind="thermal")
    layer = earth.index(earth.load(area, s.latest_clear()), "heat")
    stats = earth.measure(layer)
    f = earth.fires(area, last="30d", radius_km=10)
    return {"findings": {"heat": stats.mean, "fires": f.total}, "evidence": [], "blocks": [],
            "notes": []}
"""


def test_sandboxed_script_can_use_heat_and_fires():
    from app.services.sandbox import public_names, run_script, scan_script

    assert "fires" in public_names()["earth"]
    assert scan_script(SCRIPT) is None
    out = asyncio.run(run_script(SCRIPT, {}, "r_heat"))
    assert out.ok, out.error
    assert out.result.findings["fires"] == 3
    assert [c.fn for c in out.calls][-1] == "fires"
    assert "3 fire detections within 10 km in 30 days" in out.calls[-1].summary


# --- network ------------------------------------------------------------------------------------


@network
def test_real_hoo_hok_wai_heat_inside_vs_ring(monkeypatch):
    monkeypatch.setenv("EARTH_IMPL", "real")
    area = HOO_HOK_WAI
    ring = earth.surroundings(area)
    found = earth.scenes(area, last="1y", kind="thermal")
    assert found.kind == "thermal" and found.scenes
    # B12.2 quotes 16 Apr 2026 as 40.0 °C inside vs 34.4 °C around; that pass is ~95% masked by
    # QA_PIXEL over the area, so it is not "usable". Use the newest clear pass, print the numbers.
    scene = found.latest_clear()
    a = earth.measure(earth.index(earth.load(area, scene), "heat"))
    b = earth.measure(earth.index(earth.load(ring, scene), "heat"))
    print(f"HEAT {scene.id} {scene.date}: inside {a.mean:.1f} C vs ring {b.mean:.1f} C")
    assert 10 < b.mean < 60 and 10 < a.mean < 60
    assert a.clean_px >= 10 and a.provenance.provider == "planetary_landsat_c2_l2"


@network
@pytest.mark.skipif(not os.environ.get("FIRMS_MAP_KEY"), reason="needs FIRMS_MAP_KEY")
def test_real_fires(monkeypatch):
    monkeypatch.setenv("EARTH_IMPL", "real")
    f = earth.fires(HOO_HOK_WAI, last="10d", radius_km=50)
    assert f.total >= len(f.detections)
    assert f.provenance.provider == "nasa_firms_viirs_nrt"
