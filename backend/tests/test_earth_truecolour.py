"""True-colour then/now (M3). Offline stub tests always run; the network test needs

EARTH_NETWORK_TESTS=1 EARTH_IMPL=real uv run pytest tests/test_earth_truecolour.py -s
"""

from __future__ import annotations

import asyncio
import os
from datetime import date
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

import earth
from app.services.sandbox import run_script, scan_script
from earth.errors import EarthError
from earth.presets import HOO_HOK_WAI
from earth.render import RGB_OUTSIDE_DIM, rgb_to_png_array

NETWORK = os.environ.get("EARTH_NETWORK_TESTS") == "1"
network = pytest.mark.skipif(not NETWORK, reason="needs network: EARTH_NETWORK_TESTS=1")
offline = pytest.mark.skipif(NETWORK, reason="stub-only")


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    if not NETWORK:
        monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("EARTH_IMPL", "stub")
    earth.set_run("r_tc")
    yield
    earth.set_run(None)


def _png(url: str) -> Image.Image:
    assert url.startswith("/api/layers/r_tc/rgb/") and url.endswith(".png")
    from earth import settings

    return Image.open(settings.data_dir() / url.removeprefix("/api/"))


@offline
def test_stub_render_raw_layer_writes_rgba_png():
    area = HOO_HOK_WAI
    s = earth.scenes(area, last="1y").clear()[0]
    r = earth.render(earth.load(area, s))
    assert r.measure is None and r.scene == s.id and r.date == s.date
    assert len(r.bounds) == 4
    img = _png(r.url)
    assert img.mode == "RGBA" and img.size[0] > 8
    a = np.asarray(img)
    assert a[0, 0, 3] == 255  # dimmed outside the outline, not cut off
    c = a.shape[0] // 2
    assert a[0, 0, :3].sum() < a[c, c, :3].sum()  # outside is darker than the centre


@offline
def test_stub_then_now_differs_and_validates():
    area = HOO_HOK_WAI
    before = earth.render(earth.load(area, earth.scenes(area, last="3y").clear()[-1]))
    after = earth.render(earth.load(area, earth.scenes(area, last="60d").latest_clear()))
    block = earth.show.then_now(before, after, title="Then and now", area=area)
    assert block.measure is None
    assert earth.validate_block(block.model_dump(mode="json"))
    pb, pa = np.asarray(_png(before.url)), np.asarray(_png(after.url))
    c = pb.shape[0] // 2
    assert abs(pb[c, c, :3].astype(int) - pa[c, c, :3].astype(int)).sum() > 10


def test_rgb_writer_stretch_and_transparency():
    refl = np.full((4, 4, 3), 0.15, np.float32)
    refl[0, 0] = np.nan
    inside = np.ones((4, 4), bool)
    inside[3, 3] = False
    px = rgb_to_png_array(refl, inside)
    k = px.shape[0] // 4  # small grids are upscaled
    assert px.shape[0] >= 640
    assert px[0, 0, 3] == 0  # no data is transparent
    assert px[k + k // 2, k + k // 2, 3] == 255
    inner = px[k + k // 2, k + k // 2, 0]
    assert px[-1, -1, 0] == pytest.approx(inner * RGB_OUTSIDE_DIM, abs=2)  # dimmed outside


@offline
def test_measure_render_unchanged():
    area = HOO_HOK_WAI
    s = earth.scenes(area, last="60d").latest_clear()
    r = earth.render(earth.index(earth.load(area, s), "greenness"))
    assert r.measure == "greenness" and "/greenness/" in r.url


SCRIPT = """
import earth

def run(**params):
    area = earth.Area.from_point(22.534, 114.0906, radius_m=350, name="Hoo Hok Wai")
    sc = earth.scenes(area, last="3y").clear()
    b = earth.render(earth.load(area, sc[-1]))
    a = earth.render(earth.load(area, sc[0]))
    blk = earth.show.then_now(b, a, title="Then and now", area=area, primary=True)
    return {"findings": {}, "evidence": [], "blocks": [blk], "notes": []}
"""


@offline
def test_sandbox_runs_true_colour_then_now():
    assert scan_script(SCRIPT) is None
    out = asyncio.run(run_script(SCRIPT, {}, "r_tc"))
    assert out.ok, out.error
    assert out.result.blocks[0].measure is None


@offline
def test_radar_raw_layer_is_hinted(monkeypatch):
    from earth import truecolour

    class L:
        scene = type("S", (), {"kind": "radar"})()

    monkeypatch.setattr("earth.real._get", lambda _id: L())
    with pytest.raises(EarthError, match="roughness"):
        truecolour.layer_rgb("x")


@network
def test_real_true_colour_hoo_hok_wai():
    from earth import real

    out = Path(os.environ.get("TRUECOLOUR_OUT", "/private/tmp/claude-501/truecolour"))
    out.mkdir(parents=True, exist_ok=True)
    area = HOO_HOK_WAI
    old = [s for s in real.scenes_between(area, date(2023, 1, 1), date(2023, 12, 31)) if s.usable]
    assert old
    new = earth.scenes(area, last="90d").latest_clear()
    for tag, sc in (("2023", old[0]), ("latest", new)):
        r = earth.render(earth.load(area, sc))
        img = _png(r.url)
        assert img.mode == "RGBA"
        img.save(out / f"hhw_{tag}.png")
