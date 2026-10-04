"""Place records: one JSON file per user, `<EARTH_DATA_DIR>/places/<user_id>.json`.

Geometry is validated and measured by `earth.Area`; memory lives in `memory.py`.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path

import earth
from app.schemas.places import CreatePlaceRequest, DetailRow, PatchPlaceRequest, PlaceDto
from app.services import memory, watches
from app.services.memory import ID_RE
from earth import settings as earth_settings
from earth.errors import BudgetExceeded
from earth.presets import HOO_HOK_WAI

log = logging.getLogger(__name__)
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()

#: The demo place every user starts with (the preset's outline).
DEMO_PLACE_ID = "pl_hhw"


def _path(user_id: str) -> Path:
    if not ID_RE.fullmatch(user_id):
        raise ValueError(f"invalid user_id: {user_id!r}")
    return earth_settings.data_dir() / "places" / f"{user_id}.json"


def _lock(path: Path) -> threading.Lock:
    with _guard:
        return _locks.setdefault(str(path), threading.Lock())


def _load(path: Path, user_id: str | None = None) -> list[dict]:
    """Read the user's places, seeding the demo place on the user's first visit (see
    `_seed_once`). A corrupt file is moved aside to `.corrupt` and treated as empty.
    Callers must hold `_lock(path)`."""
    try:
        text = path.read_text(encoding="utf-8")
    except (FileNotFoundError, NotADirectoryError):
        rows: list[dict] = []
    else:
        try:
            rows = json.loads(text)
            if not isinstance(rows, list):
                raise ValueError("places file is not a list")
        except ValueError:  # JSONDecodeError is a ValueError
            log.warning("corrupt places file %s: moved to .corrupt, starting empty", path)
            os.replace(path, path.with_name(path.name + ".corrupt"))
            rows = []
    if user_id is not None:
        rows = _seed_once(path, rows)
    return rows


def _seed_marker(path: Path) -> Path:
    return path.with_name(path.stem + ".seeded")


def _seed_once(path: Path, rows: list[dict]) -> list[dict]:
    """Every user gets the example places once (Hoo Hok Wai plus a few from around the world),
    so the Places page is never empty and each kind of question has somewhere to try it. The
    marker file lists the ids already offered: a deleted example never comes back, and an
    example added later is still offered once to existing users.
    Callers must hold `_lock(path)`."""
    marker = _seed_marker(path)
    offered: set[str] = set()
    if marker.exists():
        # Older markers are empty files written when only the demo place existed.
        offered = {line.strip() for line in marker.read_text().splitlines() if line.strip()}
        offered = offered or {DEMO_PLACE_ID}
    have = {r.get("id") for r in rows}
    new = [r for r in _seed() if r["id"] not in offered and r["id"] not in have]
    if new:
        rows = [*rows, *new]
        _save(path, rows)
    if new or not marker.exists():
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("\n".join(sorted(offered | {r["id"] for r in _seed()})) + "\n")
    return rows


def _save(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=1)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:20].strip("_")
    return f"pl_{s or 'place'}"


def _new_id(name: str, taken: set[str]) -> str:
    """Always randomised, so a deleted place's memory file is never inherited by a new one."""
    while True:
        cand = f"{_slug(name)}_{uuid.uuid4().hex[:6]}"
        if cand not in taken:
            return cand


def _area(
    geometry: dict | None, center: dict | None, radius_m: float | None, name: str
) -> earth.Area:
    """Validate with earth; raises EarthError (InvalidArea / BudgetExceeded)."""
    if geometry is not None:
        area = earth.Area.from_geojson(geometry, name=name)
    else:
        assert center is not None and radius_m is not None
        area = earth.Area.from_point(center["lat"], center["lon"], radius_m=radius_m, name=name)
    if area.area_ha > earth_settings.MAX_AREA_HA:
        raise BudgetExceeded(
            f"{area.area_ha:.0f} ha is above the {earth_settings.MAX_AREA_HA} ha limit.",
            "draw a smaller outline (max 25 km² for now)",
        )
    return area


def _center(area: earth.Area) -> dict:
    lat, lon = area.centroid()
    return {"lat": round(lat, 6), "lon": round(lon, 6)}


def _dto(row: dict, user_id: str) -> PlaceDto:
    mem = memory.get_place(user_id, row["id"])
    details = [DetailRow(label=k, value=v.value) for k, v in mem.profile.items()] if mem else []
    return PlaceDto(**row, details=details)


# Example places offered to every user, beside the Hoo Hok Wai demo: one per kind of question.
_HYDE_PARK = earth.Area.from_geojson(
    {
        "type": "Polygon",
        "coordinates": [
            [
                [-0.1874, 51.5083],
                [-0.1868, 51.5112],
                [-0.1588, 51.5135],
                [-0.1528, 51.5103],
                [-0.1569, 51.5046],
                [-0.1772, 51.5027],
                [-0.1874, 51.5083],
            ]
        ],
    },
    name="Hyde Park",
)
_KAI_TAK = earth.Area.from_point(22.3236, 114.2004, radius_m=450, name="Kai Tak Sports Park")
_NAROK = earth.Area.from_point(-1.0, 35.75, radius_m=500, name="Wheat fields, Narok")
_EXAMPLES: list[tuple[str, earth.Area, str, list[str], bool]] = [
    ("pl_example_hyde_park", _HYDE_PARK, "forests", ["Park", "Example"], False),
    ("pl_example_kai_tak", _KAI_TAK, "urban", ["Building site", "Example"], True),
    ("pl_example_narok", _NAROK, "agriculture", ["Farm", "Example"], True),
]


def _seed() -> list[dict]:
    """The demo place (the Hoo Hok Wai preset) and the example places."""
    now = _now()
    rows = [
        {
            "id": DEMO_PLACE_ID,
            "name": "Hoo Hok Wai ponds",
            "category_key": "water",
            "center": _center(HOO_HOK_WAI),
            "geometry": HOO_HOK_WAI.geojson,
            "area_ha": HOO_HOK_WAI.area_ha,
            "is_circle": True,
            "project": None,
            "tags": ["Wetland", "NGO"],
            "source": "search",
            "created_at": now,
            "updated_at": now,
        }
    ]
    for pid, area, category, tags, circle in _EXAMPLES:
        rows.append(
            {
                "id": pid,
                "name": area.name,
                "category_key": category,
                "center": _center(area),
                "geometry": area.geojson,
                "area_ha": area.area_ha,
                "is_circle": circle,
                "project": "Examples",
                "tags": tags,
                "source": "search",
                "created_at": now,
                "updated_at": now,
            }
        )
    return rows


def list_places(user_id: str) -> list[PlaceDto]:
    path = _path(user_id)
    with _lock(path):
        rows = _load(path, user_id)
    rows.reverse()  # ties (same second): later insertion first
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    return [_dto(r, user_id) for r in rows]


def get_place(user_id: str, place_id: str) -> PlaceDto | None:
    if not ID_RE.fullmatch(place_id):
        return None
    path = _path(user_id)
    with _lock(path):
        rows = _load(path, user_id)
    for row in rows:
        if row["id"] == place_id:
            return _dto(row, user_id)
    return None


def create_place(user_id: str, req: CreatePlaceRequest) -> PlaceDto:
    center = req.center.model_dump() if req.center else None
    area = _area(req.geometry, center, req.radius_m, req.name)
    path = _path(user_id)
    with _lock(path):
        rows = _load(path, user_id)
        now = _now()
        row = {
            "id": _new_id(req.name, {r["id"] for r in rows}),
            "name": req.name,
            "category_key": req.category_key,
            "center": _center(area),
            "geometry": area.geojson,
            "area_ha": area.area_ha,
            "is_circle": req.is_circle if req.is_circle is not None else req.geometry is None,
            "project": req.project,
            "tags": req.tags,
            "source": req.source,
            "created_at": now,
            "updated_at": now,
        }
        rows.append(row)
        _save(path, rows)
    if req.details:
        memory.write_profile(user_id, row["id"], {d.label: d.value for d in req.details})
    return _dto(row, user_id)


def update_place(user_id: str, place_id: str, req: PatchPlaceRequest) -> PlaceDto | None:
    if not ID_RE.fullmatch(place_id):
        return None
    path = _path(user_id)
    with _lock(path):
        rows = _load(path, user_id)
        row = next((r for r in rows if r["id"] == place_id), None)
        if row is None:
            return None
        name = req.name if req.name is not None else row["name"]
        if req.geometry is not None or req.center is not None:
            center = req.center.model_dump() if req.center else None
            area = _area(req.geometry, center, req.radius_m, name)
            row.update(
                geometry=area.geojson,
                area_ha=area.area_ha,
                center=_center(area),
                is_circle=req.geometry is None,
            )
        if req.is_circle is not None:
            row["is_circle"] = req.is_circle
        row["name"] = name
        if req.category_key is not None:
            row["category_key"] = req.category_key
        if "project" in req.model_fields_set:  # explicit null clears it
            row["project"] = req.project
        if req.tags is not None:
            row["tags"] = req.tags
        row["updated_at"] = _now()
        _save(path, rows)
    return _dto(row, user_id)


def delete_place(user_id: str, place_id: str) -> bool:
    """Removes the record and its memory file, and detaches its watches (they become general
    ones, not deleted). Nothing of the place is left on disk."""
    if not ID_RE.fullmatch(place_id):
        return False
    path = _path(user_id)
    with _lock(path):
        rows = _load(path, user_id)
        kept = [r for r in rows if r["id"] != place_id]
        if len(kept) == len(rows):
            return False
        _save(path, kept)
    watches.detach_place(user_id, place_id)  # its watches become general ones, not deleted
    memory.forget_place(user_id, place_id)
    return True
