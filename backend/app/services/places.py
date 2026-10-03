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
from app.services import memory
from app.services.memory import ID_RE
from earth import settings as earth_settings
from earth.errors import BudgetExceeded
from earth.presets import HOO_HOK_WAI

log = logging.getLogger(__name__)
_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


def _path(user_id: str) -> Path:
    if not ID_RE.fullmatch(user_id):
        raise ValueError(f"invalid user_id: {user_id!r}")
    return earth_settings.data_dir() / "places" / f"{user_id}.json"


def _lock(path: Path) -> threading.Lock:
    with _guard:
        return _locks.setdefault(str(path), threading.Lock())


def _load(path: Path, user_id: str | None = None) -> list[dict]:
    """Read the user's places. Seeds the demo user's first visit; a corrupt file is moved
    aside to `.corrupt` and treated as empty. Callers must hold `_lock(path)`."""
    try:
        text = path.read_text(encoding="utf-8")
    except (FileNotFoundError, NotADirectoryError):
        if user_id == "demo":
            rows = _seed()
            _save(path, rows)
            return rows
        return []
    try:
        rows = json.loads(text)
        if not isinstance(rows, list):
            raise ValueError("places file is not a list")
        return rows
    except ValueError:  # JSONDecodeError is a ValueError
        log.warning("corrupt places file %s: moved to .corrupt, starting empty", path)
        os.replace(path, path.with_name(path.name + ".corrupt"))
        return []


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


def _seed() -> list[dict]:
    """Demo user's first visit: the Hoo Hok Wai preset, so the Places page is not empty."""
    now = _now()
    return [
        {
            "id": "pl_hhw",
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
    """Removes the record. Ids are never reused, so the orphaned memory file is unreachable."""
    if not ID_RE.fullmatch(place_id):
        return False
    path = _path(user_id)
    with _lock(path):
        rows = _load(path, user_id)
        kept = [r for r in rows if r["id"] != place_id]
        if len(kept) == len(rows):
            return False
        _save(path, kept)
    return True
