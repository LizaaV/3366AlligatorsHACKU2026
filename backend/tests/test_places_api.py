import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
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
    assert 30 < places[0]["area_ha"] < 45
    assert client.get("/api/places").json() == places  # seeded once


def test_every_new_user_gets_the_demo_place(client: TestClient) -> None:
    for user in ("alice", "u-7f3a9c1e"):
        ids = [x["id"] for x in client.get("/api/places", headers={"X-User-Id": user}).json()]
        assert ids == ["pl_hhw"]


def test_demo_place_seeded_once_per_user_and_not_after_delete(client: TestClient) -> None:
    a = {"X-User-Id": "alice"}
    b = {"X-User-Id": "bob"}
    client.get("/api/places", headers=a)
    assert [x["id"] for x in client.get("/api/places", headers=a).json()] == ["pl_hhw"]
    assert client.delete("/api/places/pl_hhw", headers=a).status_code == 204
    assert client.get("/api/places", headers=a).json() == []  # never reseeded
    assert client.get("/api/places/pl_hhw", headers=a).status_code == 404
    assert [x["id"] for x in client.get("/api/places", headers=b).json()] == ["pl_hhw"]


def test_existing_user_without_marker_gets_the_demo_place_once(
    client: TestClient, tmp_path: Path
) -> None:
    a = {"X-User-Id": "alice"}
    p = client.post("/api/places", json={"name": "Mine", "geometry": SQUARE}, headers=a).json()
    ids = [x["id"] for x in client.get("/api/places", headers=a).json()]
    assert sorted(ids) == sorted([p["id"], "pl_hhw"])
    (tmp_path / "places" / "alice.seeded").unlink()  # a file from before the marker existed
    ids = [x["id"] for x in client.get("/api/places", headers=a).json()]
    assert ids.count("pl_hhw") == 1


def test_create_polygon_and_get(client: TestClient) -> None:
    res = client.post(
        "/api/places",
        json={"name": "North Pond", "geometry": SQUARE, "tags": ["Fish"], "project": "NGO"},
    )
    assert res.status_code == 201
    p = res.json()
    assert ID_RE.fullmatch(p["id"]) and p["id"].startswith("pl_north_pond")
    assert p["area_ha"] > 0 and p["is_circle"] is False
    assert 22.53 < p["center"]["lat"] < 22.532 and 114.09 < p["center"]["lon"] < 114.092
    assert client.get(f"/api/places/{p['id']}").json() == p
    # newest first
    ids = [x["id"] for x in client.get("/api/places").json()]
    assert ids[0] == p["id"] and ids[1:] == ["pl_hhw"]  # demo seeded on first load of any call


def test_create_point_radius_and_unique_ids(client: TestClient) -> None:
    body = {"name": "Pin", "center": {"lat": 22.5, "lon": 114.0}, "radius_m": 200, "source": "pin"}
    a = client.post("/api/places", json=body).json()
    b = client.post("/api/places", json=body).json()
    assert a["is_circle"] is True and a["source"] == "pin"
    assert a["id"] != b["id"]


def test_create_with_details_goes_to_memory(client: TestClient) -> None:
    p = client.post(
        "/api/places",
        json={"name": "D", "geometry": SQUARE, "details": [{"label": "Crop", "value": "Rice"}]},
    ).json()
    assert p["details"] == [{"label": "Crop", "value": "Rice"}]


def test_create_validation(client: TestClient) -> None:
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
    pt = {"name": "big", "center": {"lat": 22.5, "lon": 114.0}, "radius_m": 5000}
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
    assert q["id"] == p["id"] and q["area_ha"] == p["area_ha"]
    # geometry change recomputes area
    r2 = client.patch(
        f"/api/places/{p['id']}", json={"center": {"lat": 22.5, "lon": 114.0}, "radius_m": 100}
    )
    assert r2.json()["area_ha"] != p["area_ha"] and r2.json()["is_circle"] is True
    # invalid geometry rejected, record unchanged
    assert client.patch(f"/api/places/{p['id']}", json={"geometry": SWAPPED}).status_code == 400
    assert client.get(f"/api/places/{p['id']}").json()["area_ha"] == r2.json()["area_ha"]
    assert client.patch(f"/api/places/{p['id']}", json={"geometry": HUGE}).status_code == 400


def test_delete_then_recreate_does_not_resurrect_memory(client: TestClient) -> None:
    p = client.post("/api/places", json={"name": "Farm A", "geometry": SQUARE}).json()
    assert re.fullmatch(r"pl_farm_a_[0-9a-f]{6}", p["id"])
    client.patch(f"/api/places/{p['id']}/memory", json={"note": "hello"})
    assert client.delete(f"/api/places/{p['id']}").status_code == 204
    assert client.get(f"/api/places/{p['id']}").status_code == 404
    assert client.delete(f"/api/places/{p['id']}").status_code == 404
    q = client.post("/api/places", json={"name": "Farm A", "geometry": SQUARE}).json()
    assert q["id"] != p["id"]
    mem = client.get(f"/api/places/{q['id']}/memory").json()
    assert mem["notes"] == [] and mem["profile"] == {}


def test_frontend_create_payload_with_center_and_geometry(client: TestClient) -> None:
    """The frontend's CreatePlaceRequest sends center AND geometry (snake_case), plus `project`."""
    payload = {
        "name": "Pond 7",
        "category_key": "water",
        "center": {"lat": 22.5307, "lon": 114.0907},
        "geometry": SQUARE,
        "is_circle": False,
        "project": "NGO",
        "tags": ["Wetland"],
        "source": "drawn",
        "details": [{"label": "Owner", "value": "Co-op"}],
    }
    res = client.post("/api/places", json=payload)
    assert res.status_code == 201, res.text
    p = res.json()
    assert p["details"] == [{"label": "Owner", "value": "Co-op"}]
    # PATCH may carry both too: geometry wins, center is ignored
    r2 = client.patch(
        f"/api/places/{p['id']}", json={"center": {"lat": 1, "lon": 1}, "geometry": SQUARE}
    )
    assert r2.status_code == 200 and r2.json()["center"] == p["center"]


def test_patch_sets_is_circle_explicitly(client: TestClient) -> None:
    p = client.post("/api/places", json={"name": "A", "geometry": SQUARE}).json()
    assert p["is_circle"] is False
    assert client.patch(f"/api/places/{p['id']}", json={"is_circle": True}).json()["is_circle"]


def test_snake_case_only(client: TestClient) -> None:
    p = client.post("/api/places", json={"name": "A", "geometry": SQUARE}).json()
    assert {"category_key", "area_ha", "is_circle", "created_at", "updated_at"} <= set(p)
    assert not any(k in p for k in ("categoryKey", "areaHa", "isCircle", "createdAt"))


def test_geometry_size_limit(client: TestClient) -> None:
    ring = [[114.09 + i * 1e-9, 22.53] for i in range(60_000)]
    big = {"type": "Polygon", "coordinates": [ring + [ring[0]]]}
    assert client.post("/api/places", json={"name": "big", "geometry": big}).status_code == 422
    p = client.post("/api/places", json={"name": "ok", "geometry": SQUARE}).json()
    assert client.patch(f"/api/places/{p['id']}", json={"geometry": big}).status_code == 422


def test_field_limits(client: TestClient) -> None:
    base = {"name": "x", "geometry": SQUARE}
    row = {"label": "k", "value": "v"}
    assert client.post("/api/places", json={**base, "tags": ["t" * 41]}).status_code == 422
    assert client.post("/api/places", json={**base, "tags": ["t"] * 21}).status_code == 422
    assert client.post("/api/places", json={**base, "details": [row] * 31}).status_code == 422
    bad_label = [{"label": "l" * 41, "value": "v"}]
    assert client.post("/api/places", json={**base, "details": bad_label}).status_code == 422
    bad_value = [{"label": "l", "value": "v" * 301}]
    assert client.post("/api/places", json={**base, "details": bad_value}).status_code == 422


def test_corrupt_file_is_moved_aside_not_500(client: TestClient, tmp_path: Path) -> None:
    f = tmp_path / "places" / "alice.json"
    f.parent.mkdir(parents=True)
    f.write_text("{not json")
    a = {"X-User-Id": "alice"}
    assert [x["id"] for x in client.get("/api/places", headers=a).json()] == ["pl_hhw"]
    assert (tmp_path / "places" / "alice.json.corrupt").read_text() == "{not json"
    new = {"name": "n", "geometry": SQUARE}
    assert client.post("/api/places", json=new, headers=a).status_code == 201


def test_get_by_id_seeds_demo_first(client: TestClient) -> None:
    assert client.get("/api/places/pl_hhw").status_code == 200


def test_404s_and_bad_ids(client: TestClient) -> None:
    assert client.get("/api/places/pl_nope").status_code == 404
    assert client.get("/api/places/Bad..Id").status_code == 422  # path pattern
    assert client.patch("/api/places/pl_nope", json={"name": "x"}).status_code == 404
    assert client.delete("/api/places/pl_nope").status_code == 404


def test_user_isolation(client: TestClient) -> None:
    a = {"X-User-Id": "alice"}
    b = {"X-User-Id": "bob"}
    p = client.post("/api/places", json={"name": "Mine", "geometry": SQUARE}, headers=a).json()
    assert [x["id"] for x in client.get("/api/places", headers=a).json()] == [p["id"], "pl_hhw"]
    assert [x["id"] for x in client.get("/api/places", headers=b).json()] == ["pl_hhw"]
    assert client.get(f"/api/places/{p['id']}", headers=b).status_code == 404
    assert client.delete(f"/api/places/{p['id']}", headers=b).status_code == 404
    assert all(x["id"] != p["id"] for x in client.get("/api/places").json())  # demo


@pytest.mark.parametrize("bad", ["Bad User", "../x", "UPPER", "", "a" * 65])
def test_invalid_user_header(client: TestClient, bad: str) -> None:
    res = client.get("/api/places", headers={"X-User-Id": bad})
    assert res.status_code == 400
