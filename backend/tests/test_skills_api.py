import hashlib
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import catalog
from app.services import skills as svc
from app.services.agent import skills as registry

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


def test_listing_equals_the_agent_registry(client: TestClient) -> None:
    """One source of truth: the listing is the agent's skill registry, nothing more or less."""
    res = client.get("/api/skills")
    assert res.status_code == 200
    assert [s["id"] for s in res.json()] == registry.skill_ids()
    assert "pond-filling-check" in registry.skill_ids()


def test_every_registry_skill_has_an_overlay_entry() -> None:
    """A new skill folder needs presentation data (category, satellites, ...) in the overlay."""
    overlay = json.loads((catalog.REGISTRY / "skill_overlay.json").read_text(encoding="utf-8"))
    assert set(registry.skill_ids()) <= set(overlay)
    assert set(overlay) <= set(registry.skill_ids())  # no overlay for skills that do not exist


def test_pond_filling_check_comes_from_its_skill_md(client: TestClient) -> None:
    sk = registry.get_skill("pond-filling-check")
    s = client.get("/api/skills/pond-filling-check").json()
    assert s["name"] == sk.name == "Pond filling check"
    assert s["short"] == sk.summary
    assert s["version"] == f"{sk.version}.0.0"
    assert s["status"] == "available"
    assert s["long"].startswith("Checks one group of fishponds")
    assert s["limits"] and all(isinstance(x, str) for x in s["limits"])
    assert s["limits"][0].startswith("Who did the filling")
    # presentation-only fields come from the overlay
    assert s["category_key"] == "water"
    assert s["sat"] == "Sentinel-2"
    assert s["publisher"]["name"] == "Earth Agent"
    assert s["steps"][0] == "area.mark"
    assert s["updated_at"].endswith("Z")


def test_no_invented_metrics(client: TestClient) -> None:
    for s in client.get("/api/skills").json():
        assert s["runs"] is None
        assert s["rating"] is None
        assert s["accuracy"] is None


def test_filter_by_category(client: TestClient) -> None:
    water = client.get("/api/skills", params={"category": "water"}).json()
    assert [s["id"] for s in water] == ["pond-filling-check"]
    assert client.get("/api/skills", params={"category": "nope"}).json() == []


def test_filter_by_tier(client: TestClient) -> None:
    free = client.get("/api/skills", params={"tier": "free"}).json()
    assert "pond-filling-check" in {s["id"] for s in free}
    assert client.get("/api/skills", params={"tier": "paid"}).json() == []
    assert client.get("/api/skills", params={"tier": "gold"}).status_code == 422


def test_filter_by_text(client: TestClient) -> None:
    hits = client.get("/api/skills", params={"q": "  POND "}).json()
    assert "pond-filling-check" in {s["id"] for s in hits}
    assert client.get("/api/skills", params={"q": "zzz-nothing"}).json() == []


def test_get_unknown_is_404(client: TestClient) -> None:
    assert client.get("/api/skills/no-such-skill").status_code == 404
    assert client.get("/api/skills/no-such-skill/manifest").status_code == 404
    # ids of the old static prototype library are gone
    assert client.get("/api/skills/dry-patch-finder").status_code == 404


def test_get_malformed_id_is_422(client: TestClient) -> None:
    assert client.get("/api/skills/Bad%20Id").status_code == 422


# --- manifest --------------------------------------------------------------------------------


def test_manifest_of_registry_skill_pins_the_script(client: TestClient) -> None:
    m = client.get("/api/skills/pond-filling-check/manifest").json()
    assert m["status"] == "available"
    assert m["version"] == "1.0.0"
    assert m["code_ref"] == "skills/pond-filling-check/run.py"
    script = (BACKEND / m["code_ref"]).read_bytes()
    assert m["code_sha256"] == hashlib.sha256(script).hexdigest()
    skill = client.get("/api/skills/pond-filling-check").json()
    assert [s["module"] for s in m["steps"]] == skill["steps"]
    assert m["accuracy"]["statement"] is None
    assert m["accuracy"]["known_limits"] == skill["limits"]


def test_manifest_steps_are_catalog_modules(client: TestClient) -> None:
    modules = {m["id"] for m in client.get("/api/catalog").json()["modules"]}
    for s in client.get("/api/skills").json():
        m = client.get(f"/api/skills/{s['id']}/manifest").json()
        assert [st["module"] for st in m["steps"]] == s["steps"]
        assert set(s["steps"]) <= modules, s["id"]


def test_listing_follows_the_registry(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A skill folder added to the registry shows up without touching the overlay."""
    root = tmp_path / "skills"
    shutil.copytree(registry.SKILLS_DIR, root)
    shutil.copytree(root / "pond-filling-check", root / "extra-skill")
    text = (root / "extra-skill" / "SKILL.md").read_text(encoding="utf-8")
    (root / "extra-skill" / "SKILL.md").write_text(
        text.replace("id: pond-filling-check", "id: extra-skill").replace(
            "name: Pond filling check", "name: Extra skill"
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(registry, "SKILLS_DIR", root)
    monkeypatch.setattr(svc, "SKILLS_DIR", root)
    monkeypatch.setattr(svc, "BACKEND", tmp_path)  # code_ref resolves to <tmp>/skills/<id>/run.py
    registry.clear_cache()
    try:
        ids = [s["id"] for s in client.get("/api/skills").json()]
        assert ids == ["extra-skill", "pond-filling-check"]
        extra = client.get("/api/skills/extra-skill").json()
        assert extra["name"] == "Extra skill" and extra["status"] == "available"
    finally:
        monkeypatch.undo()
        registry.clear_cache()


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
    assert {s["status"] for s in client.get("/api/skills", headers=ALICE).json()} == {"available"}


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
