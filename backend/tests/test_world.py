"""World test set (docs/BUILD-PLAN.md section 8.2).

* Schema tests run in normal `pytest` (no network): they validate world_test_set.yaml.
* `@pytest.mark.world` tests run only with `uv run pytest -m world` and `EARTH_IMPL=real`.
  They call the real `earth` package and check the SIGN of the change, not exact numbers.
"""

from __future__ import annotations

import re
from datetime import date as Date
from pathlib import Path
from typing import Literal

import pytest
import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

YAML_PATH = Path(__file__).parent / "world_test_set.yaml"

Kind = Literal[
    "vegetation_loss",
    "water_loss",
    "flood",
    "burn_scar",
    "construction",
    "cropland",
    "urban_small",
    "control",
]
KINDS = set(Kind.__args__)  # type: ignore[attr-defined]
INDEX_MEASURES = {"greenness", "moisture", "water", "bare", "roughness"}

NOISE_FLOOR = 0.02  # |delta| below this does not count as "up" / "down"
FLAT_LIMIT = 0.05  # |delta| below this counts as "flat"
DEFAULT_CONTROL_TOLERANCE = 0.1


class Circle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    radius_m: float = Field(gt=0)


class AreaSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    radius_m: float | None = Field(default=None, gt=0)
    geojson: dict | None = None

    @model_validator(mode="after")
    def _one_form(self) -> AreaSpec:
        point = None not in (self.lat, self.lon, self.radius_m)
        if point == (self.geojson is not None):
            raise ValueError("area needs either {lat, lon, radius_m} or {geojson}")
        return self

    @property
    def latitude(self) -> float:
        if self.lat is not None:
            return self.lat
        coords = self.geojson["coordinates"][0]  # type: ignore[index]
        return sum(c[1] for c in coords) / len(coords)


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: Date | None = None
    range: tuple[Date, Date] | None = None
    what: str = Field(min_length=10)


class Expected(BaseModel):
    model_config = ConfigDict(extra="forbid")
    direction: dict[str, Literal["up", "down", "flat"]]
    changed: bool
    measure_only_ok: bool
    control_tolerance: float = DEFAULT_CONTROL_TOLERANCE
    error: str | None = None
    notes: str = ""

    @model_validator(mode="after")
    def _known_measures(self) -> Expected:
        unknown = set(self.direction) - INDEX_MEASURES
        if unknown:
            raise ValueError(f"unknown measures {unknown}")
        return self


class Windows(BaseModel):
    before: tuple[Date, Date]
    after: tuple[Date, Date]


class Scenes(BaseModel):
    before: list[str] = Field(min_length=1)
    after: list[str] = Field(min_length=1)


class Place(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: Kind
    name: str
    question: str
    area: AreaSpec
    event: Event
    expected: Expected
    control: AreaSpec
    must_exercise: list[str] = Field(min_length=1)
    windows: Windows
    scenes_seen: Scenes
    sources: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def _consistent(self) -> Place:
        w = self.windows
        if not (w.before[0] <= w.before[1] < w.after[0] <= w.after[1]):
            raise ValueError(
                "windows must be ordered: before.start <= before.end < after.start <= after.end"
            )
        if not all(s.startswith("http") for s in self.sources):
            raise ValueError("sources must be URLs")
        for sid in self.scenes_seen.before + self.scenes_seen.after:
            if not re.fullmatch(r"S2[ABC]_\d{2}[A-Z]{3}_\d{8}_\d+_L2A", sid):
                raise ValueError(f"not an Earth Search Sentinel-2 id: {sid}")
        if (
            self.kind != "urban_small"
            and self.expected.error is None
            and not self.expected.direction
        ):
            raise ValueError("expected.direction needed unless an error is expected")
        return self

    def scene_date(self, side: str) -> Date:
        sid = getattr(self.scenes_seen, side)[0]
        raw = sid.split("_")[2]
        return Date(int(raw[:4]), int(raw[4:6]), int(raw[6:]))


def load_places() -> list[Place]:
    raw = yaml.safe_load(YAML_PATH.read_text())
    return [Place.model_validate(r) for r in raw]


# ---------------------------------------------------------------- schema tests (CI-safe)


def test_world_set_schema() -> None:
    places = load_places()
    assert len(places) == 8
    assert len({p.id for p in places}) == 8
    assert {p.kind for p in places} == KINDS


def test_world_set_geography_and_sources() -> None:
    places = load_places()
    south = [p for p in places if p.area.latitude < 0]
    assert len(south) >= 2
    assert all(p.sources for p in places)
    # Sentinel-2 L2A before and after: every window ends before today's data and starts after 2015.
    assert all(Date(2015, 6, 23) <= p.windows.before[0] for p in places)


def test_world_set_area_sizes() -> None:
    import math

    for p in load_places():
        if p.area.radius_m is None:
            continue
        ha = math.pi * p.area.radius_m**2 / 1e4
        assert ha <= 2500, f"{p.id}: {ha:.0f} ha is over the 25 km2 budget"
        if p.kind == "urban_small":
            assert ha < 1
        else:
            assert ha >= 2, f"{p.id}: {ha:.2f} ha is under 2 ha"


def test_world_set_documents_tile_edge() -> None:
    assert any("mgrs_tile_edge" in p.must_exercise for p in load_places())


# ---------------------------------------------------------------- world tests (real earth)


def _earth():
    earth = pytest.importorskip(
        "earth", reason="backend/earth/ not on this branch (lands via PR #5)"
    )
    settings = getattr(earth, "settings", None)
    impl = settings.impl() if settings is not None and hasattr(settings, "impl") else None
    if impl != "real":
        pytest.skip(f"EARTH_IMPL is {impl!r}; set EARTH_IMPL=real to run the world tests")
    return earth


def _area(earth, spec: AreaSpec):
    if spec.geojson is not None:
        return earth.Area.from_geojson(spec.geojson)
    return earth.Area.from_point(spec.lat, spec.lon, spec.radius_m)


def _delta(result) -> float:
    value = result["delta"] if isinstance(result, dict) else result.delta
    return float(value)


def _sign_ok(direction: str, delta: float) -> bool:
    if direction == "up":
        return delta > NOISE_FLOOR
    if direction == "down":
        return delta < -NOISE_FLOOR
    return abs(delta) < FLAT_LIMIT


PLACES = load_places()


@pytest.mark.world
@pytest.mark.parametrize("place", PLACES, ids=lambda p: p.id)
def test_place_direction(place: Place) -> None:
    earth = _earth()
    area = _area(earth, place.area)
    before, after = place.scene_date("before"), place.scene_date("after")

    if place.expected.error:
        with pytest.raises(Exception) as err:  # noqa: B017 - EarthError subclasses vary
            earth.compare(area, "greenness", before, after)
        assert type(err.value).__name__ == place.expected.error
        return

    for measure, direction in place.expected.direction.items():
        delta = _delta(earth.compare(area, measure, before, after))
        assert _sign_ok(direction, delta), (
            f"{place.id} {measure}: expected {direction}, delta={delta:+.3f}"
        )


@pytest.mark.world
@pytest.mark.parametrize("place", PLACES, ids=lambda p: p.id)
def test_control_does_not_change(place: Place) -> None:
    earth = _earth()
    if place.expected.error:
        pytest.skip("urban_small: the place itself must be refused; control is not compared")
    control = _area(earth, place.control)
    before, after = place.scene_date("before"), place.scene_date("after")
    for measure in place.expected.direction:
        delta = _delta(earth.compare(control, measure, before, after))
        assert abs(delta) <= place.expected.control_tolerance, (
            f"{place.id} control {measure}: |delta|={abs(delta):.3f} "
            f"> {place.expected.control_tolerance}"
        )
