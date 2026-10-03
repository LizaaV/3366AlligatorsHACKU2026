from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import memory
from app.services.memory import ID_RE

SQUARE = {  # ~11 ha near Hoo Hok Wai, [lon, lat]
    "type": "Polygon",
    "coordinates": [
        [
            [114.09, 22.53],
            [114.0915, 22.53],
            [114.0915, 22.5315],
            [114.09, 22.5315],
            [114.09, 22.53],
        ]
    ],
}
SWAPPED = {
    "type": "Polygon",
    "coordinates": [
        [
            [22.53, 114.09],
            [22.5315, 114.09],
            [22.5315, 114.0915],
            [22.53, 114.0915],
            [22.53, 114.09],
        ]
    ],
}
HUGE = {  # ~0.1 deg square, well over 25 km2
    "type": "Polygon",
    "coordinates": [[[114.0, 22.5], [114.1, 22.5], [114.1, 22.6], [114.0, 22.6], [114.0, 22.5]]],
}


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    return TestClient(app)


def test_demo_seed_and_list(client: TestClient) -> None:
    res = client.get("/api/places")
    assert res.status_code == 200
    places = res.json()
    assert [p["id"] for p in places] == ["pl_hhw"]
    assert places[0]["tags"] == ["Wetland", "NGO"]
    assert places[0]["source"] == "search"
    assert 30 < places[0]["areaHa"] < 45
    assert client.get("/api/places").json() == places  # seeded once


def test_seed_only_for_demo(client: TestClient) -> None:
    assert client.get("/api/places", headers={"X-User-Id": "alice"}).json() == []


def test_create_polygon_and_get(client: TestClient) -> None:
    res = client.post(
        "/api/places",
        json={"name": "North Pond", "geometry": SQUARE, "tags": ["Fish"], "project": "NGO"},
    )
    assert res.status_code == 201
    p = res.json()
    assert ID_RE.fullmatch(p["id"]) and p["id"].startswith("pl_north_pond")
    assert p["areaHa"] > 0 and p["isCircle"] is False
    assert 22.53 < p["center"]["lat"] < 22.532 and 114.09 < p["center"]["lon"] < 114.092
    assert client.get(f"/api/places/{p['id']}").json() == p
    # newest first
    ids = [x["id"] for x in client.get("/api/places").json()]
    assert ids[0] == p["id"] and len(ids) == 1  # demo seed only on first list with no file


def test_create_point_radius_and_unique_ids(client: TestClient) -> None:
    body = {"name": "Pin", "center": {"lat": 22.5, "lon": 114.0}, "radiusM": 200, "source": "pin"}
    a = client.post("/api/places", json=body).json()
    b = client.post("/api/places", json=body).json()
    assert a["isCircle"] is True and a["source"] == "pin"
    assert a["id"] != b["id"]


def test_create_with_details_goes_to_memory(client: TestClient) -> None:
    p = client.post(
        "/api/places",
        json={"name": "D", "geometry": SQUARE, "details": [{"label": "Crop", "value": "Rice"}]},
    ).json()
    assert p["details"] == [{"label": "Crop", "value": "Rice"}]


def test_create_validation(client: TestClient) -> None:
    both = {"name": "x", "geometry": SQUARE, "center": {"lat": 1, "lon": 1}, "radiusM": 5}
    assert client.post("/api/places", json=both).status_code == 422
    assert client.post("/api/places", json={"name": "x"}).status_code == 422
    nor = {"name": "x", "center": {"lat": 1, "lon": 1}}
    assert client.post("/api/places", json=nor).status_code == 422


def test_swapped_lat_lon_is_400_with_hint(client: TestClient) -> None:
    res = client.post("/api/places", json={"name": "bad", "geometry": SWAPPED})
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert detail["kind"] == "invalid_area" and "swap" in detail["hint"]


def test_too_big_is_400_budget(client: TestClient) -> None:
    res = client.post("/api/places", json={"name": "big", "geometry": HUGE})
    assert res.status_code == 400
    assert res.json()["detail"]["kind"] == "budget_exceeded"
    pt = {"name": "big", "center": {"lat": 22.5, "lon": 114.0}, "radiusM": 5000}
    assert client.post("/api/places", json=pt).json()["detail"]["kind"] == "budget_exceeded"


def test_not_a_polygon_is_400(client: TestClient) -> None:
    pt = {"type": "Point", "coordinates": [114.0, 22.5]}
    res = client.post("/api/places", json={"name": "p", "geometry": pt})
    assert res.status_code == 400


def test_patch(client: TestClient) -> None:
    p = client.post("/api/places", json={"name": "A", "geometry": SQUARE, "project": "x"}).json()
    res = client.patch(f"/api/places/{p['id']}", json={"name": "B", "tags": ["t"], "project": None})
    assert res.status_code == 200
    q = res.json()
    assert q["name"] == "B" and q["tags"] == ["t"] and q["project"] is None
    assert q["id"] == p["id"] and q["areaHa"] == p["areaHa"]
    # geometry change recomputes area
    r2 = client.patch(
        f"/api/places/{p['id']}", json={"center": {"lat": 22.5, "lon": 114.0}, "radiusM": 100}
    )
    assert r2.json()["areaHa"] != p["areaHa"] and r2.json()["isCircle"] is True
    # invalid geometry rejected, record unchanged
    assert client.patch(f"/api/places/{p['id']}", json={"geometry": SWAPPED}).status_code == 400
    assert client.get(f"/api/places/{p['id']}").json()["areaHa"] == r2.json()["areaHa"]
    assert client.patch(f"/api/places/{p['id']}", json={"geometry": HUGE}).status_code == 400


def test_delete_keeps_memory(client: TestClient) -> None:
    p = client.post("/api/places", json={"name": "A", "geometry": SQUARE}).json()
    client.patch(f"/api/places/{p['id']}/memory", json={"note": "hello"})
    assert client.delete(f"/api/places/{p['id']}").status_code == 204
    assert client.get(f"/api/places/{p['id']}").status_code == 404
    assert client.delete(f"/api/places/{p['id']}").status_code == 404
    got = memory.get_place("demo", p["id"])
    assert got is not None and got.notes[0].text == "hello"


def test_404s_and_bad_ids(client: TestClient) -> None:
    assert client.get("/api/places/pl_nope").status_code == 404
    assert client.get("/api/places/Bad..Id").status_code == 404
    assert client.patch("/api/places/pl_nope", json={"name": "x"}).status_code == 404
    assert client.delete("/api/places/pl_nope").status_code == 404


def test_user_isolation(client: TestClient) -> None:
    a = {"X-User-Id": "alice"}
    b = {"X-User-Id": "bob"}
    p = client.post("/api/places", json={"name": "Mine", "geometry": SQUARE}, headers=a).json()
    assert [x["id"] for x in client.get("/api/places", headers=a).json()] == [p["id"]]
    assert client.get("/api/places", headers=b).json() == []
    assert client.get(f"/api/places/{p['id']}", headers=b).status_code == 404
    assert client.delete(f"/api/places/{p['id']}", headers=b).status_code == 404
    assert all(x["id"] != p["id"] for x in client.get("/api/places").json())  # demo


@pytest.mark.parametrize("bad", ["Bad User", "../x", "UPPER", "", "a" * 65])
def test_invalid_user_header(client: TestClient, bad: str) -> None:
    res = client.get("/api/places", headers={"X-User-Id": bad})
    assert res.status_code == 400
