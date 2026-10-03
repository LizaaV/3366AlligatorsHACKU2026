"""Skills registry (issue #41): built-in skills plus skills made in the builder.

- Built-in, `available`: skills with a script in `backend/skills/<id>/run.py` (today only
  `pond-filling-check`). Their manifest carries `code_ref` + `code_sha256`.
- Built-in, `concept`: the library entries carried over from the design prototype
  (`app/registry/skills.json`). They have no implementation, so `runs`, `rating` and
  `accuracy` are null rather than the prototype's invented numbers.
- User-made, `draft`: one JSON file, `<EARTH_DATA_DIR>/skills/registry.json`. Visible to their
  owner, and to everyone when `visibility` is 'public'. 'team' behaves like 'private' until the
  app has teams.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.schemas.skills import (
    CreateSkillRequest,
    ManifestAccuracy,
    Pricing,
    Publisher,
    SkillDto,
    SkillInput,
    SkillManifest,
    SkillOutput,
    SkillStep,
)
from app.services import catalog
from earth import settings as earth_settings

log = logging.getLogger(__name__)
_lock = threading.Lock()

BACKEND = Path(__file__).resolve().parents[2]
SKILL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

_AREA_INPUT = {
    "key": "area",
    "type": "geometry",
    "required": True,
    "accepts": ["place", "polygon", "geojson", "kml"],
}
_DRAFT_OUTPUTS = [
    {"key": "layers", "type": "raster[]"},
    {"key": "summary", "type": "text", "languages": "auto"},
    {"key": "metrics", "type": "metric[]", "with_confidence": True},
    {"key": "proof", "type": "proof_pack"},
]

# --- Built-in skills with a real implementation ------------------------------------------------

#: `pond-filling-check` (backend/skills/pond-filling-check): steps describe what run.py does,
#: with the params it actually uses (60-day scene search, 4 years of monthly series, ...).
_POND = {
    "id": "pond-filling-check",
    "category_key": "water",
    "name": "Pond filling check",
    "sat": "Sentinel-2",
    "cost": "Free",
    "tier": "free",
    "price": None,
    "short": "Checks whether fish ponds have been filled in, and when.",
    "long": "Compares the water, bare-ground and greenness series inside the ponds with the "
    "surroundings over the last four years, finds when the change started, and scores the "
    "pond-filling hypothesis against its look-alikes (seasonal drying, water loss, "
    "construction, new bare ground) using the knowledge cards' signs and weights.",
    "publisher": {"name": "Earth Agent", "official": True, "verified": False},
    "reference": {"lat": 22.534, "lon": 114.0906},  # Hoo Hok Wai preset
    "res": "10 m",
    "revisit": "5 days",
    "version": "0.1.0",
    "updated_at": "2026-10-03T13:51:17Z",
    "limits": [
        "Radar (Sentinel-1 roughness) is not used yet, so construction is hard to rule out.",
        "Optical satellites cannot see through cloud; cloudy passes are skipped.",
        "Outlines must be between about 20 m across and 25 km².",
    ],
    "inputs": [_AREA_INPUT, {"key": "context", "type": "answers", "required": False}],
    "steps": [
        {"module": "area.mark", "params": {}},
        {"module": "time.window", "params": {"recent_days": 60, "baseline_years": 4}},
        {"module": "sat.route", "params": {"prefer": "free", "candidates": ["s2"]}},
        {"module": "scenes.filter", "params": {"max_cloud_pct": 30}},
        {"module": "scenes.clean", "params": {"mask": "SCL"}},
        {"module": "index.compute", "params": {"indices": ["NDWI", "NDBI", "NDVI", "NDMI"]}},
        {"module": "detect.change", "params": {}},
        {
            "module": "explain.cause",
            "params": {
                "cards": [
                    "pond_filling",
                    "seasonal",
                    "water_loss",
                    "construction",
                    "new_bare_or_built",
                ]
            },
        },
        {"module": "output.map", "params": {"confidence": True}},
    ],
    "outputs": _DRAFT_OUTPUTS,
    "code_ref": "skills/pond-filling-check/run.py",
}
IMPLEMENTED = (_POND,)


@dataclass(frozen=True)
class _Entry:
    skill: SkillDto
    manifest: SkillManifest
    owner: str | None = None  # None = built-in


def _sha256(code_ref: str) -> str:
    return hashlib.sha256((BACKEND / code_ref).read_bytes()).hexdigest()


def _entry(row: dict[str, Any], status: str, owner: str | None = None) -> _Entry:
    steps = [SkillStep(**s) for s in row["steps"]]
    visibility = row.get("visibility", "public")
    publisher = Publisher(**row["publisher"])
    code_ref = row.get("code_ref")
    skill = SkillDto(
        id=row["id"],
        category_key=row["category_key"],
        name=row["name"],
        sat=row["sat"],
        cost=row["cost"],
        tier=row["tier"],
        short=row["short"],
        long=row.get("long", ""),
        publisher=publisher,
        reference=row.get("reference"),
        res=row.get("res"),
        revisit=row.get("revisit"),
        version=row["version"],
        updated_at=row["updated_at"],
        steps=[s.module for s in steps],
        limits=row.get("limits", []),
        status=status,  # type: ignore[arg-type]
        visibility=visibility,
    )
    manifest = SkillManifest(
        id=skill.id,
        version=skill.version,
        name=skill.name,
        category_key=skill.category_key,
        status=skill.status,
        visibility=visibility,
        publisher=publisher,
        pricing=Pricing(tier=skill.tier, price=row.get("price")),
        inputs=[SkillInput(**i) for i in row.get("inputs", [])],
        steps=steps,
        outputs=[SkillOutput(**o) for o in row.get("outputs", [])],
        accuracy=ManifestAccuracy(
            resolution=skill.res, revisit=skill.revisit, known_limits=skill.limits
        ),
        code_ref=code_ref,
        code_sha256=_sha256(code_ref) if code_ref else None,
    )
    return _Entry(skill, manifest, owner)


@lru_cache(maxsize=1)
def _builtins() -> tuple[_Entry, ...]:
    concept = json.loads((catalog.REGISTRY / "skills.json").read_text(encoding="utf-8"))
    return tuple(
        [_entry(r, "available") for r in IMPLEMENTED] + [_entry(r, "concept") for r in concept]
    )


# --- User-made skills ---------------------------------------------------------------------------


def _path() -> Path:
    return earth_settings.data_dir() / "skills" / "registry.json"


def _load(path: Path) -> list[dict[str, Any]]:
    """Caller holds `_lock`. A corrupt file is moved aside and treated as empty."""
    try:
        text = path.read_text(encoding="utf-8")
    except (FileNotFoundError, NotADirectoryError):
        return []
    try:
        rows = json.loads(text)
        if not isinstance(rows, list):
            raise ValueError("skills file is not a list")
        return rows
    except ValueError:
        log.warning("corrupt skills file %s: moved to .corrupt, starting empty", path)
        os.replace(path, path.with_name(path.name + ".corrupt"))
        return []


def _save(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=1)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _user_entries(user_id: str) -> list[_Entry]:
    with _lock:
        rows = _load(_path())
    visible = [r for r in rows if r["owner"] == user_id or r["visibility"] == "public"]
    visible.sort(key=lambda r: r["updated_at"], reverse=True)
    return [_entry(r, "draft", owner=r["owner"]) for r in visible]


def _all(user_id: str) -> list[_Entry]:
    return [*_builtins(), *_user_entries(user_id)]


# --- Public API ---------------------------------------------------------------------------------


class SkillValidationError(ValueError):
    """Request is well-formed but refers to unknown catalog entries. `errors` uses FastAPI's
    422 item shape (`type`, `loc`, `msg`, `input`)."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        super().__init__("; ".join(e["msg"] for e in errors))
        self.errors = errors


def check_steps(steps: list[SkillStep], loc: tuple[str, ...] = ("body", "steps")) -> None:
    known = catalog.module_ids()
    errors = [
        {
            "type": "unknown_module",
            "loc": [*loc, i, "module"],
            "msg": f"Unknown module {s.module!r}: use an id from GET /api/catalog modules.",
            "input": s.module,
        }
        for i, s in enumerate(steps)
        if s.module not in known
    ]
    if errors:
        raise SkillValidationError(errors)


def list_skills(
    user_id: str, category: str | None = None, tier: str | None = None, q: str | None = None
) -> list[SkillDto]:
    needle = (q or "").strip().lower()
    out = []
    for e in _all(user_id):
        s = e.skill
        if category and s.category_key != category:
            continue
        if tier and s.tier != tier:
            continue
        if needle and needle not in f"{s.name} {s.short} {s.publisher.name}".lower():
            continue
        out.append(s)
    return out


def _find(user_id: str, skill_id: str) -> _Entry | None:
    if not SKILL_ID_RE.fullmatch(skill_id):
        return None
    return next((e for e in _all(user_id) if e.skill.id == skill_id), None)


def get_skill(user_id: str, skill_id: str) -> SkillDto | None:
    e = _find(user_id, skill_id)
    return e.skill if e else None


def get_manifest(user_id: str, skill_id: str) -> SkillManifest | None:
    e = _find(user_id, skill_id)
    return e.manifest if e else None


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40].strip("-") or "skill"


def _route_satellites(steps: list[SkillStep]) -> list[str]:
    """Catalog satellite ids named in any step's `candidates`, in order."""
    known = {s.id for s in catalog.get_catalog().satellites}
    out: list[str] = []
    for s in steps:
        cands = s.params.get("candidates")
        for c in cands if isinstance(cands, list) else []:
            if isinstance(c, str) and c in known and c not in out:
                out.append(c)
    return out


def create_skill(user_id: str, req: CreateSkillRequest) -> SkillDto:
    errors: list[dict[str, Any]] = []
    if req.category_key not in catalog.category_keys():
        errors.append(
            {
                "type": "unknown_category",
                "loc": ["body", "category_key"],
                "msg": f"Unknown category {req.category_key!r}: use a key from GET /api/catalog.",
                "input": req.category_key,
            }
        )
    try:
        check_steps(req.steps)
    except SkillValidationError as exc:
        errors += exc.errors
    if errors:
        raise SkillValidationError(errors)

    sats = {s.id: s for s in catalog.get_catalog().satellites}
    routed = [sats[i] for i in _route_satellites(req.steps)]
    taken = {e.skill.id for e in _builtins()}
    now = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    row: dict[str, Any] = {
        "owner": user_id,
        "category_key": req.category_key,
        "name": req.name,
        "sat": " · ".join(s.name for s in routed),
        "cost": req.cost,
        "tier": req.tier,
        "price": None,
        "short": req.short,
        "long": req.long,
        "publisher": {"name": user_id, "official": False, "verified": False},
        "reference": None,
        "res": routed[0].res if routed else None,
        "revisit": routed[0].revisit if routed else None,
        "version": "0.1.0",
        "updated_at": now,
        "limits": [],
        "visibility": req.visibility,
        "inputs": [_AREA_INPUT],
        "steps": [s.model_dump() for s in req.steps],
        "outputs": _DRAFT_OUTPUTS,
    }
    path = _path()
    with _lock:
        rows = _load(path)
        taken |= {r["id"] for r in rows}
        while True:
            row["id"] = f"{_slug(req.name)}-{uuid.uuid4().hex[:6]}"
            if row["id"] not in taken:
                break
        rows.append(row)
        _save(path, rows)
    return _entry(row, "draft", owner=user_id).skill
