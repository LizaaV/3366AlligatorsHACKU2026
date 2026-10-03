import typing

from fastapi.testclient import TestClient

import earth
from app.main import app

client = TestClient(app)


def test_catalog_sections() -> None:
    res = client.get("/api/catalog")
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {
        "categories",
        "satellites",
        "modules",
        "channels",
        "languages",
        "map_layers",
    }
    assert len(body["categories"]) == 9
    assert len(body["modules"]) == 12
    assert len(body["languages"]) == 25
    assert {c["id"] for c in body["channels"]} == {"email", "push", "whatsapp", "sms", "slack"}


def test_categories_have_no_colours() -> None:
    cats = client.get("/api/catalog").json()["categories"]
    assert "agriculture" in {c["key"] for c in cats}
    for c in cats:
        assert set(c) == {"key", "name", "icon", "uses", "sats"}


def test_only_wired_satellites_are_connected() -> None:
    sats = client.get("/api/catalog").json()["satellites"]
    assert {s["id"] for s in sats if s["connected"]} == {"s2", "s1", "l9", "viirs"}
    paid = next(s for s in sats if s["id"] == "ps")
    assert paid["tier"] == "paid" and paid["price"]


def test_modules_have_default_params() -> None:
    mods = {m["id"]: m for m in client.get("/api/catalog").json()["modules"]}
    assert mods["scenes.filter"]["params"]["max_cloud_pct"] == 20
    assert mods["output.map"]["params"]["confidence"] is True
    assert mods["index.compute"]["group"] == "Analysis"


def test_map_layers_match_what_earth_renders() -> None:
    layers = client.get("/api/catalog").json()["map_layers"]
    assert [la["id"] for la in layers] == ["rgb", *typing.get_args(earth.Measure)]
    water = next(la for la in layers if la["id"] == "water")
    assert water["index"] == "NDWI"
    assert water["url_template"] == "/api/layers/{run_id}/water/{scene}.png"
    assert all("color" not in la for la in layers)
