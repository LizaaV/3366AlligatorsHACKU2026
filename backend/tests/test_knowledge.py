"""Tests for the knowledge package: the real knowledge base, each validation rule, helpers."""

import copy
from pathlib import Path
from typing import Any

import pytest
import yaml

from knowledge import KnowledgeError, check_knowledge, load_knowledge, parse_card
from knowledge.loader import PACKAGE_DIR, CardParseError
from knowledge.validate import main as validate_main

# --- The real knowledge base ----------------------------------------------------------------


@pytest.mark.skipif(
    not (PACKAGE_DIR / "events").is_dir(),
    reason="backend/knowledge/events/ does not exist yet (cards not written)",
)
def test_real_knowledge_base_loads_without_errors() -> None:
    result = check_knowledge()
    assert result.errors == [], "\n".join(result.errors)
    kb = load_knowledge()
    assert kb.events and kb.settings
    assert kb.index_text().count("\n") == len(kb.events) + len(kb.settings) - 1


# --- Mini knowledge base builder ------------------------------------------------------------

EVENT_BODY = """
## What it is
Text.

## How it shows up from space
Text.

## How to tell it apart
Text.

## Limits
Text.

## Sources
Text.
"""

SETTING_BODY = """
## What it is
Text.

## What normal looks like
Text.

## Pitfalls
Text.
"""


def event(eid: str, looks_like: list[str], **over: Any) -> dict[str, Any]:
    h: dict[str, Any] = {
        "id": eid,
        "type": "event",
        "version": 1,
        "status": "draft",
        "name": eid.replace("_", " ").title(),
        "aliases": [],
        "category": "disasters",
        "summary": f"Summary of {eid}.",
        "min_size_m": 30,
        "timing": "sudden",
        "occurs_in": ["forest"],
        "signs": [
            {"measure": "greenness", "change": "down", "by_more_than": 0.2, "weight": 3},
            {"measure": "bare", "change": "up", "weight": 2},
            {"measure": "slope_deg", "change": "above", "threshold": 20, "weight": 1},
        ],
        "looks_like": [
            {"event": o, "tell_apart_by": "Shape.", "discriminating_measures": ["slope_deg"]}
            for o in looks_like
        ],
        "cannot_tell": ["Who did it.", "Exact date under cloud."],
        "confidence": {"high_min_weight": 5, "medium_min_weight": 3},
        "suggested_blocks": ["then_now"],
        "cases": [
            {
                "place": "Somewhere",
                "lat": 22.3,
                "lon": 114.1,
                "location_precision": "approximate",
                "date": "2023-09-08",
                "expected": "detected",
                "source": "Agency report",
                "url": "https://example.org/report",
                "verified": True,
            }
        ],
        "controls": [
            {
                "place": "Nearby",
                "lat": 22.4,
                "lon": 114.2,
                "location_precision": "approximate",
                "date": "2023-09",
                "expected": "not_detected",
                "verified": False,
            }
        ],
        "sources": [{"title": "ESA", "url": "https://esa.int"}],
    }
    h.update(over)
    return h


def setting(sid: str, codes: list[int], **over: Any) -> dict[str, Any]:
    h: dict[str, Any] = {
        "id": sid,
        "type": "setting",
        "version": 1,
        "status": "draft",
        "name": sid.replace("_", " ").title(),
        "aliases": [],
        "summary": f"Summary of {sid}.",
        "worldcover_classes": codes,
        "detect": {"land_cover_any": codes, "min_fraction": 0.3},
        "normal": [{"measure": "greenness", "typical_min": 0.5, "typical_max": 0.9}],
        "likely_events": ["landslide"],
        "pitfalls": ["Cloud."],
        "sources": [{"title": "ESA WorldCover", "url": "https://esa-worldcover.org"}],
    }
    h.update(over)
    return h


RULES = {
    "version": 1,
    "rules": [
        {
            "id": "identify_person",
            "kind": "not_allowed",
            "action": "block",
            "description": "Identify people.",
            "examples": ["Who lives here?", "Whose car is this?", "Name the owner"],
            "not_examples": ["How many houses?", "Is this land built up?"],
            "checks": [],
            "reply": "no_people",
            "alternatives": False,
            "log": True,
            "version": 1,
        }
    ],
}
TEMPLATES = {"version": 1, "templates": {"no_people": {"text": "We do not identify people."}}}
TESTS = {
    "version": 1,
    "cases": [
        {
            "question": "Who lives here?",
            "expected_rule": "identify_person",
            "expected_action": "block",
        },
        {"question": "Did the slope fail?", "expected_rule": None, "expected_action": "allow"},
    ],
}


def default_kb() -> dict[str, Any]:
    return {
        "events": {
            "landslide": (
                event("landslide", ["construction"], aliases=["山泥傾瀉", "mudslide"]),
                EVENT_BODY,
            ),
            "construction": (
                event(
                    "construction", ["landslide"], category="urban", wording={"avoid": ["illegal"]}
                ),
                EVENT_BODY,
            ),
        },
        "settings": {
            "forest": (setting("forest", [10]), SETTING_BODY),
            "town": (setting("town", [50, 60], likely_events=["construction"]), SETTING_BODY),
        },
        "policy": {"rules.yaml": RULES, "templates.yaml": TEMPLATES, "tests.yaml": TESTS},
    }


def card_text(header: dict[str, Any], body: str) -> str:
    return "---\n" + yaml.safe_dump(header, allow_unicode=True, sort_keys=False) + "---\n" + body


def write_kb(root: Path, spec: dict[str, Any]) -> Path:
    for folder in ("events", "settings"):
        (root / folder).mkdir(parents=True, exist_ok=True)
        for name, content in spec[folder].items():
            text = content if isinstance(content, str) else card_text(*content)
            (root / folder / f"{name}.md").write_text(text, encoding="utf-8")
    (root / "policy").mkdir(parents=True, exist_ok=True)
    for name, data in spec["policy"].items():
        (root / "policy" / name).write_text(yaml.safe_dump(data, allow_unicode=True))
    return root


@pytest.fixture
def spec() -> dict[str, Any]:
    return copy.deepcopy(default_kb())


def errors_for(tmp_path: Path, spec: dict[str, Any]) -> list[str]:
    result = check_knowledge(write_kb(tmp_path, spec))
    return result.errors


def assert_one_error(errors: list[str], *fragments: str) -> None:
    hits = [e for e in errors if all(f in e for f in fragments)]
    assert hits, f"no error containing {fragments!r} in:\n" + "\n".join(errors)


# --- Validation rules -----------------------------------------------------------------------


def test_mini_kb_is_valid(tmp_path: Path, spec: dict[str, Any]) -> None:
    result = check_knowledge(write_kb(tmp_path, spec))
    assert result.errors == []
    assert result.kb is not None
    assert set(result.kb.events) == {"landslide", "construction"}


def test_errors_are_all_collected(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["events"]["landslide"][0]["signs"][0]["measure"] = "ndvi"
    spec["settings"]["forest"][0]["likely_events"] = ["meteor"]
    with pytest.raises(KnowledgeError) as exc:
        load_knowledge(write_kb(tmp_path, spec))
    assert len(exc.value.errors) >= 2
    assert "ndvi" in str(exc.value) and "meteor" in str(exc.value)


def test_bad_front_matter(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["events"]["landslide"] = "# no front matter\n" + EVENT_BODY
    errors = errors_for(tmp_path, spec)
    assert_one_error(errors, "events/landslide.md", "must start with")


def test_unclosed_and_invalid_yaml(tmp_path: Path) -> None:
    p = tmp_path / "a.md"
    p.write_text("---\nid: a\n")
    with pytest.raises(CardParseError, match="not closed"):
        parse_card(p)
    p.write_text("---\nid: [a\n---\nbody\n")
    with pytest.raises(CardParseError, match="not valid YAML"):
        parse_card(p)
    p.write_text("---\nid: a\n---\nbody\n")
    assert parse_card(p) == ({"id": "a"}, "body\n")


def test_pydantic_error_and_extra_field(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["events"]["landslide"][0]["sumary"] = "typo"
    spec["events"]["landslide"][0]["status"] = "approved"
    errors = errors_for(tmp_path, spec)
    assert_one_error(errors, "events/landslide.md", "sumary")
    assert_one_error(errors, "events/landslide.md", "status")


def test_broken_link(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["events"]["landslide"][0]["triggered_by"] = [{"event": "earthquake", "note": "shaking"}]
    spec["events"]["landslide"][0]["occurs_in"] = ["forest", "volcano"]
    errors = errors_for(tmp_path, spec)
    assert_one_error(errors, "triggered_by.0.event", "earthquake")
    assert_one_error(errors, "occurs_in.1", "volcano")


def test_unknown_measure(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["events"]["landslide"][0]["signs"][1]["measure"] = "ndbi"
    errors = errors_for(tmp_path, spec)
    assert_one_error(errors, "signs.1", "unknown measure 'ndbi'")


def test_asymmetric_looks_like(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["events"]["construction"][0]["looks_like"] = []
    errors = errors_for(tmp_path, spec)
    assert_one_error(errors, "events/landslide.md", "symmetric", "construction")


def test_event_cannot_list_itself(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["events"]["landslide"][0]["looks_like"].append(
        {"event": "landslide", "tell_apart_by": "x", "discriminating_measures": []}
    )
    assert_one_error(errors_for(tmp_path, spec), "cannot list itself")


def test_id_filename_mismatch(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["events"]["landslide"][0]["id"] = "land_slide"
    assert_one_error(errors_for(tmp_path, spec), "events/landslide.md", "file name")


def test_duplicate_id_across_folders(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["settings"]["landslide"] = (setting("landslide", [10]), SETTING_BODY)
    assert_one_error(errors_for(tmp_path, spec), "duplicate id 'landslide'")


def test_type_must_match_folder(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["settings"]["forest"][0]["type"] = "event"
    assert_one_error(errors_for(tmp_path, spec), "settings/forest.md", "does not match folder")


def test_missing_template(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["policy"]["rules.yaml"]["rules"][0]["reply"] = "nope"
    errors = errors_for(tmp_path, spec)
    assert_one_error(errors, "policy/rules.yaml", "template 'nope' not found")


def test_block_rule_alternatives_and_unknown_test_rule(
    tmp_path: Path, spec: dict[str, Any]
) -> None:
    spec["policy"]["rules.yaml"]["rules"][0]["alternatives"] = True
    spec["policy"]["tests.yaml"]["cases"][0]["expected_rule"] = "ghost"
    errors = errors_for(tmp_path, spec)
    assert_one_error(errors, "alternatives: false")
    assert_one_error(errors, "policy/tests.yaml", "unknown rule 'ghost'")


def test_duplicate_rule_and_unused_template_warning(tmp_path: Path, spec: dict[str, Any]) -> None:
    rules = spec["policy"]["rules.yaml"]["rules"]
    rules.append(copy.deepcopy(rules[0]))
    spec["policy"]["templates.yaml"]["templates"]["spare"] = {"text": "Unused."}
    result = check_knowledge(write_kb(tmp_path, spec))
    assert_one_error(result.errors, "duplicate rule id 'identify_person'")
    assert any("'spare' is not used" in w for w in result.warnings)


def test_planned_measure_sign_must_be_optional(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["events"]["landslide"][0]["signs"].append({"measure": "heat", "change": "up", "weight": 1})
    assert_one_error(errors_for(tmp_path, spec), "signs.3", "must be optional")


def test_too_few_v1_signs(tmp_path: Path, spec: dict[str, Any]) -> None:
    signs = spec["events"]["landslide"][0]["signs"]
    signs[1]["optional"] = True
    signs[2]["optional"] = True
    signs.append({"measure": "fire", "change": "up", "weight": 1, "optional": True})
    assert_one_error(errors_for(tmp_path, spec), "at least 2 non-optional signs", "has 1")


def test_weights_and_confidence(tmp_path: Path, spec: dict[str, Any]) -> None:
    card = spec["events"]["landslide"][0]
    card["signs"][0]["weight"] = 4
    spec["events"]["construction"][0]["confidence"] = {"high_min_weight": 9, "medium_min_weight": 9}
    errors = errors_for(tmp_path, spec)
    assert_one_error(errors, "events/landslide.md", "signs.0.weight")
    assert_one_error(errors, "events/construction.md", "must be > medium_min_weight")
    assert_one_error(errors, "events/construction.md", "exceed the total sign weight (6)")


def test_cannot_tell_and_verified_case_url(tmp_path: Path, spec: dict[str, Any]) -> None:
    card = spec["events"]["landslide"][0]
    card["cannot_tell"] = ["Only one."]
    card["cases"][0]["url"] = "http://insecure.example"
    errors = errors_for(tmp_path, spec)
    assert_one_error(errors, "cannot_tell needs at least 2")
    assert_one_error(errors, "cases.0", "https url")


def test_wording_required(tmp_path: Path, spec: dict[str, Any]) -> None:
    del spec["events"]["construction"][0]["wording"]
    assert_one_error(errors_for(tmp_path, spec), "events/construction.md", "wording")


def test_worldcover_codes(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["settings"]["forest"][0]["worldcover_classes"] = [10, 15]
    spec["settings"]["forest"][0]["detect"]["land_cover_any"] = [99]
    errors = errors_for(tmp_path, spec)
    assert_one_error(errors, "worldcover_classes", "15")
    assert_one_error(errors, "detect.land_cover_any", "99")


def test_missing_body_section(tmp_path: Path, spec: dict[str, Any]) -> None:
    spec["events"]["landslide"] = (
        spec["events"]["landslide"][0],
        EVENT_BODY.replace("## Limits", "## Limitations"),
    )
    assert_one_error(errors_for(tmp_path, spec), "missing the section heading '## Limits'")


def test_missing_policy_file(tmp_path: Path, spec: dict[str, Any]) -> None:
    del spec["policy"]["tests.yaml"]
    assert_one_error(errors_for(tmp_path, spec), "policy/tests.yaml", "missing")


def test_validate_cli_exit_codes(
    tmp_path: Path, spec: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    good = write_kb(tmp_path / "good", spec)
    assert validate_main(["--root", str(good)]) == 0
    assert "2 events, 2 settings, 1 rules" in capsys.readouterr().out
    spec["events"]["landslide"][0]["signs"][0]["measure"] = "ndvi"
    bad = write_kb(tmp_path / "bad", spec)
    assert validate_main(["--root", str(bad)]) == 1
    assert "ERROR" in capsys.readouterr().out


# --- Helpers --------------------------------------------------------------------------------


@pytest.fixture
def kb(tmp_path: Path, spec: dict[str, Any]):
    return load_knowledge(write_kb(tmp_path, spec))


def test_index_and_index_text(kb) -> None:
    ids = [e.id for e in kb.index()]
    assert ids == ["construction", "landslide", "forest", "town"]
    lines = kb.index_text().splitlines()
    assert len(lines) == 4
    assert lines[1].startswith("event landslide (Landslide) [draft v1]: Summary of landslide.")
    assert "aka: 山泥傾瀉, mudslide" in lines[1]
    assert lines[2].startswith("setting forest")


def test_get_and_body(kb) -> None:
    assert kb.get("landslide").type == "event"
    assert kb.get("forest").type == "setting"
    assert "## Limits" in kb.body("landslide")
    with pytest.raises(KeyError):
        kb.get("nope")


def test_find(kb) -> None:
    assert kb.find("Was there a MUDSLIDE near the town?") == ["landslide", "town"]
    assert kb.find("上星期有山泥傾瀉嗎") == ["landslide"]
    assert kb.find("Construction site in the forest") == ["construction", "forest"]
    assert kb.find("townhouses") == []  # whole words only for ASCII terms
    assert kb.find("two landslides near towns") == ["landslide", "town"]  # plural endings match


def test_lookalikes(kb) -> None:
    assert [c.id for c in kb.lookalikes("landslide")] == ["construction"]
    with pytest.raises(KeyError):
        kb.lookalikes("forest")


def test_settings_for_land_cover(kb) -> None:
    assert [s.id for s in kb.settings_for_land_cover([60, 10])] == ["town", "forest"]
    assert [s.id for s in kb.settings_for_land_cover([10])] == ["forest"]
    assert kb.settings_for_land_cover([80]) == []


def test_rule_and_template(kb) -> None:
    assert kb.rule("identify_person").action == "block"
    assert kb.template_for("identify_person").text == "We do not identify people."
    with pytest.raises(KeyError):
        kb.rule("ghost")


def test_v1_measures_match_earth() -> None:
    """Cards may only rely on measures the earth library actually computes."""
    from typing import get_args

    from earth.types import Measure
    from knowledge.schema import MEASURES_V1

    # Cards may only rely on what earth computes; earth may compute more (e.g. `heat` from M9c
    # stays "planned" for cards until their heat signs are reviewed).
    assert set(MEASURES_V1) <= set(get_args(Measure))
