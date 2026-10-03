import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

BACKEND = Path(__file__).resolve().parents[1]
ALICE = {"X-User-Id": "alice"}
BOB = {"X-User-Id": "bob"}
DRAFT = {
    "name": "Pond water check",
    "category_key": "water",
    "short": "Water index inside the ponds.",
    "tier": "free",
    "cost": "Free",
    "visibility": "private",
    "steps": [
        {"module": "sat.route", "params": {"candidates": ["s2", "l9"]}},
        {"module": "index.compute", "params": {"indices": ["NDWI"], "threshold": 0.2}},
    ],
}


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("EARTH_DATA_DIR", str(tmp_path))
    return TestClient(app)


# --- library ---------------------------------------------------------------------------------


def test_list_has_real_skill_first_then_concepts(client: TestClient) -> None:
    res = client.get("/api/skills")
    assert res.status_code == 200
    skills = res.json()
    assert len(skills) == 29
    assert skills[0]["id"] == "pond-filling-check"
    assert skills[0]["status"] == "available"
    assert {s["status"] for s in skills[1:]} == {"concept"}


def test_no_invented_metrics(client: TestClient) -> None:
    for s in client.get("/api/skills").json():
        assert s["runs"] is None
        assert s["rating"] is None
        assert s["accuracy"] is None


def test_skill_shape(client: TestClient) -> None:
    s = client.get("/api/skills/dry-patch-finder").json()
    assert s["category_key"] == "agriculture"
    assert s["tier"] == "free"
    assert s["publisher"] == {"name": "Groundtruth Labs", "official": True, "verified": True}
    assert s["reference"] == {"lat": 37.9785, "lon": -100.9155}
    assert s["steps"][:2] == ["ask.clarify", "area.mark"]
    assert s["version"] == "2.0.0"
    assert s["updated_at"].endswith("Z")
    assert s["limits"]


def test_filter_by_category(client: TestClient) -> None:
    water = client.get("/api/skills", params={"category": "water"}).json()
    assert water and all(s["category_key"] == "water" for s in water)
    assert "pond-filling-check" in {s["id"] for s in water}
    assert client.get("/api/skills", params={"category": "nope"}).json() == []


def test_filter_by_tier(client: TestClient) -> None:
    paid = client.get("/api/skills", params={"tier": "paid"}).json()
    assert {s["id"] for s in paid} == {
        "small-field-stress-3-m",
        "eudr-proof-pack",
        "rooftop-solar-potential",
        "crop-insurance-check",
    }
    assert client.get("/api/skills", params={"tier": "gold"}).status_code == 422


def test_filter_by_text(client: TestClient) -> None:
    hits = client.get("/api/skills", params={"q": "  POND "}).json()
    assert "pond-filling-check" in {s["id"] for s in hits}
    by_pub = client.get("/api/skills", params={"q": "agrisense"}).json()
    assert by_pub and all(s["publisher"]["name"] == "AgriSense Co-op" for s in by_pub)
    combo = client.get(
        "/api/skills", params={"q": "crop", "category": "agriculture", "tier": "free"}
    ).json()
    assert combo and all(s["category_key"] == "agriculture" for s in combo)


def test_get_unknown_is_404(client: TestClient) -> None:
    assert client.get("/api/skills/no-such-skill").status_code == 404
    assert client.get("/api/skills/no-such-skill/manifest").status_code == 404


def test_get_malformed_id_is_422(client: TestClient) -> None:
    assert client.get("/api/skills/Bad%20Id").status_code == 422


# --- manifest --------------------------------------------------------------------------------


def test_manifest_of_implemented_skill_pins_the_script(client: TestClient) -> None:
    m = client.get("/api/skills/pond-filling-check/manifest").json()
    assert m["status"] == "available"
    assert m["code_ref"] == "skills/pond-filling-check/run.py"
    script = (BACKEND / m["code_ref"]).read_bytes()
    assert m["code_sha256"] == hashlib.sha256(script).hexdigest()
    skill = client.get("/api/skills/pond-filling-check").json()
    assert [s["module"] for s in m["steps"]] == skill["steps"]
    assert m["accuracy"]["statement"] is None


def test_manifest_steps_are_catalog_modules(client: TestClient) -> None:
    modules = {m["id"] for m in client.get("/api/catalog").json()["modules"]}
    for s in client.get("/api/skills").json():
        m = client.get(f"/api/skills/{s['id']}/manifest").json()
        assert [st["module"] for st in m["steps"]] == s["steps"]
        assert set(s["steps"]) <= modules, s["id"]


def test_manifest_of_concept_has_no_code(client: TestClient) -> None:
    m = client.get("/api/skills/dry-patch-finder/manifest").json()
    assert m["status"] == "concept"
    assert m["code_ref"] is None and m["code_sha256"] is None
    assert m["steps"][2] == {
        "module": "time.window",
        "params": {"recent_days": 45, "baseline_years": 3},
    }
    assert m["pricing"] == {"tier": "free", "price": None}
    assert m["inputs"][0]["key"] == "area"


# --- builder ---------------------------------------------------------------------------------


def test_create_skill(client: TestClient) -> None:
    res = client.post("/api/skills", json=DRAFT, headers=ALICE)
    assert res.status_code == 201
    s = res.json()
    assert s["id"].startswith("pond-water-check-")
    assert s["status"] == "draft"
    assert s["visibility"] == "private"
    assert s["publisher"] == {"name": "alice", "official": False, "verified": False}
    assert s["steps"] == ["sat.route", "index.compute"]
    assert s["sat"] == "Sentinel-2 L2A · Landsat 9 TIRS"
    assert s["res"] == "10 m"
    assert s["runs"] is None and s["rating"] is None

    m = client.get(f"/api/skills/{s['id']}/manifest", headers=ALICE).json()
    assert m["steps"][1]["params"] == {"indices": ["NDWI"], "threshold": 0.2}
    assert m["code_ref"] is None
    assert client.get(f"/api/skills/{s['id']}", headers=ALICE).json() == s
    assert client.get("/api/skills", headers=ALICE).json()[-1] == s


def test_private_skill_is_hidden_from_others(client: TestClient) -> None:
    sid = client.post("/api/skills", json=DRAFT, headers=ALICE).json()["id"]
    assert client.get(f"/api/skills/{sid}", headers=BOB).status_code == 404
    assert client.get(f"/api/skills/{sid}/manifest", headers=BOB).status_code == 404
    assert sid not in {s["id"] for s in client.get("/api/skills", headers=BOB).json()}


def test_team_behaves_as_private_until_teams_exist(client: TestClient) -> None:
    sid = client.post("/api/skills", json={**DRAFT, "visibility": "team"}, headers=ALICE)
    assert client.get(f"/api/skills/{sid.json()['id']}", headers=BOB).status_code == 404


def test_public_skill_is_visible_to_everyone(client: TestClient) -> None:
    sid = client.post("/api/skills", json={**DRAFT, "visibility": "public"}, headers=ALICE)
    sid = sid.json()["id"]
    assert client.get(f"/api/skills/{sid}", headers=BOB).status_code == 200
    water = client.get("/api/skills", params={"category": "water"}, headers=BOB).json()
    assert sid in {s["id"] for s in water}


def test_created_skill_persists(client: TestClient) -> None:
    sid = client.post("/api/skills", json=DRAFT, headers=ALICE).json()["id"]
    fresh = TestClient(app)
    assert fresh.get(f"/api/skills/{sid}", headers=ALICE).status_code == 200


def test_create_unknown_module_is_422(client: TestClient) -> None:
    body = {**DRAFT, "steps": [{"module": "area.mark"}, {"module": "ndwi", "params": {}}]}
    res = client.post("/api/skills", json=body, headers=ALICE)
    assert res.status_code == 422
    [err] = res.json()["detail"]
    assert err["loc"] == ["body", "steps", 1, "module"]
    assert err["type"] == "unknown_module"
    assert client.get("/api/skills", headers=ALICE).json()[-1]["status"] == "concept"


def test_create_unknown_category_is_422(client: TestClient) -> None:
    res = client.post("/api/skills", json={**DRAFT, "category_key": "space"}, headers=ALICE)
    assert res.status_code == 422
    assert res.json()["detail"][0]["loc"] == ["body", "category_key"]


@pytest.mark.parametrize(
    "patch",
    [
        {"visibility": "everyone"},
        {"tier": "gold"},
        {"name": ""},
        {"steps": []},
        {"steps": [{"module": "index.compute", "params": {"x": {"nested": 1}}}]},
        {"steps": [{"module": "index.compute", "params": {"Bad Key": 1}}]},
    ],
)
def test_create_bad_input_is_422(client: TestClient, patch: dict) -> None:
    assert client.post("/api/skills", json={**DRAFT, **patch}, headers=ALICE).status_code == 422


def test_create_missing_field_is_422(client: TestClient) -> None:
    body = {k: v for k, v in DRAFT.items() if k != "short"}
    assert client.post("/api/skills", json=body).status_code == 422


# --- test (dry run) --------------------------------------------------------------------------


def test_test_endpoint_is_honestly_not_available(client: TestClient) -> None:
    res = client.post("/api/skills/test", json={"place_id": "pl_hhw", "steps": DRAFT["steps"]})
    assert res.status_code == 501
    detail = res.json()["detail"]
    assert detail["kind"] == "not_implemented"
    assert detail["message"] and detail["hint"]
    assert set(res.json()) == {"detail"}  # no scene counts or other made-up results


def test_test_endpoint_validates_first(client: TestClient) -> None:
    bad = client.post("/api/skills/test", json={"place_id": "pl_hhw", "steps": [{"module": "x"}]})
    assert bad.status_code == 422
    assert bad.json()["detail"][0]["type"] == "unknown_module"
    no_place = client.post("/api/skills/test", json={"steps": DRAFT["steps"]})
    assert no_place.status_code == 422
