"""Load and validate the knowledge base (event cards, setting cards, policy).

``load_knowledge()`` reads every file, runs every check, and raises ``KnowledgeError`` listing
all problems at once. ``check_knowledge()`` does the same without raising (used by the CLI).
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ValidationError

from .schema import (
    ALL_MEASURES,
    EVENT_SECTIONS,
    MEASURES_CONTEXT,
    MEASURES_PLANNED,
    MEASURES_V1,
    SETTING_SECTIONS,
    WORLDCOVER_CODES,
    EventCard,
    Policy,
    PolicyRule,
    RulesFile,
    SettingCard,
    Template,
    TemplatesFile,
    TestsFile,
)

PACKAGE_DIR = Path(__file__).resolve().parent

#: Events whose answers touch on people's actions: they must say how to word findings.
WORDING_REQUIRED: frozenset[str] = frozenset(
    {"pond_filling", "construction", "vegetation_loss", "new_bare_or_built"}
)
#: Rule ids the guard expects to exist (missing ones are warnings).
REQUIRED_RULES: tuple[str, ...] = (
    "identify_person",
    "surveil_private_home",
    "military_targeting",
    "harassment",
    "ownership_or_blame",
    "below_resolution",
    "no_clear_data",
    "area_too_large",
    "cannot_distinguish",
    "emergency_now",
    "off_topic",
    "prompt_injection",
    "sensitive_allegation",
)

Card = EventCard | SettingCard


class CardParseError(ValueError):
    """A card file does not have a valid front-matter header."""


class KnowledgeError(Exception):
    """The knowledge base has one or more problems. ``errors`` lists every one of them."""

    def __init__(self, errors: list[str], warnings: list[str] | None = None) -> None:
        self.errors = errors
        self.warnings = warnings or []
        lines = "\n".join(f"  - {e}" for e in errors)
        super().__init__(f"knowledge base has {len(errors)} error(s):\n{lines}")


@dataclass(frozen=True)
class IndexEntry:
    id: str
    type: str
    name: str
    summary: str
    status: str
    version: int
    aliases: list[str]


# --- Parsing --------------------------------------------------------------------------------


def parse_card(path: Path) -> tuple[dict[str, Any], str]:
    """Split a card into its YAML header (as a dict) and Markdown body.

    The file must start with a ``---`` line, then YAML, then a closing ``---`` line.
    """
    text = Path(path).read_text(encoding="utf-8").lstrip("﻿")
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].rstrip("\r\n") != "---":
        raise CardParseError("file must start with a '---' front-matter line")
    end = next((i for i in range(1, len(lines)) if lines[i].rstrip("\r\n") == "---"), None)
    if end is None:
        raise CardParseError("front matter is not closed by a '---' line")
    try:
        header = yaml.safe_load("".join(lines[1:end]))
    except yaml.YAMLError as exc:
        raise CardParseError(f"front matter is not valid YAML: {_one_line(str(exc))}") from exc
    if not isinstance(header, dict):
        raise CardParseError("front matter must be a YAML mapping")
    return header, "".join(lines[end + 1 :])


def _one_line(text: str) -> str:
    return " ".join(text.split())


def _pydantic_errors(rel: str, exc: ValidationError) -> list[str]:
    out = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err["loc"]) or "(root)"
        out.append(f"{rel}: {loc}: {err['msg']}")
    return out


# --- Knowledge base -------------------------------------------------------------------------


@dataclass
class KnowledgeBase:
    events: dict[str, EventCard]
    settings: dict[str, SettingCard]
    policy: Policy
    bodies: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    root: Path = PACKAGE_DIR

    # Cards ------------------------------------------------------------------------------

    def get(self, card_id: str) -> Card:
        if card_id in self.events:
            return self.events[card_id]
        if card_id in self.settings:
            return self.settings[card_id]
        raise KeyError(f"unknown card id: {card_id}")

    def body(self, card_id: str) -> str:
        self.get(card_id)
        return self.bodies[card_id]

    def _cards(self) -> Iterable[Card]:
        yield from (self.events[k] for k in sorted(self.events))
        yield from (self.settings[k] for k in sorted(self.settings))

    def index(self) -> list[IndexEntry]:
        return [
            IndexEntry(
                id=c.id,
                type=c.type,
                name=c.name,
                summary=c.summary,
                status=c.status,
                version=c.version,
                aliases=list(c.aliases),
            )
            for c in self._cards()
        ]

    def index_text(self) -> str:
        """One compact line per card, for the LLM system prompt."""
        lines = []
        for e in self.index():
            line = f"{e.type} {e.id} ({e.name}) [{e.status} v{e.version}]: {e.summary}"
            if e.aliases:
                line += f" | aka: {', '.join(e.aliases)}"
            lines.append(line)
        return "\n".join(lines)

    def lookalikes(self, event_id: str) -> list[EventCard]:
        card = self.events.get(event_id)
        if card is None:
            raise KeyError(f"unknown event id: {event_id}")
        return [self.events[la.event] for la in card.looks_like if la.event in self.events]

    def settings_for_land_cover(self, codes: list[int]) -> list[SettingCard]:
        """Settings whose ``detect.land_cover_any`` matches any code, in the order of ``codes``."""
        rank = {code: i for i, code in reversed(list(enumerate(codes)))}
        hits: list[tuple[int, str]] = []
        for sid, s in self.settings.items():
            matched = [rank[c] for c in s.detect.land_cover_any if c in rank]
            if matched:
                hits.append((min(matched), sid))
        return [self.settings[sid] for _, sid in sorted(hits)]

    def find(self, text: str) -> list[str]:
        """Card ids whose id, name or an alias appears in ``text`` (case-insensitive).

        Ids are ordered by where they first appear in the text.
        """
        hay = text.casefold()
        found: list[tuple[int, str]] = []
        for c in self._cards():
            terms = {c.id, c.id.replace("_", " "), c.name, *c.aliases}
            positions = [p for t in terms if t.strip() for p in [_find_term(hay, t)] if p >= 0]
            if positions:
                found.append((min(positions), c.id))
        return [cid for _, cid in sorted(found)]

    # Policy -----------------------------------------------------------------------------

    def rule(self, rule_id: str) -> PolicyRule:
        for r in self.policy.rules:
            if r.id == rule_id:
                return r
        raise KeyError(f"unknown policy rule: {rule_id}")

    def template_for(self, rule_id: str) -> Template:
        return self.policy.templates[self.rule(rule_id).reply]


def _find_term(hay: str, term: str) -> int:
    """Position of ``term`` in ``hay`` (already casefolded), or -1.

    ASCII terms must stand as whole words, optionally followed by a plural or past-tense
    ending (s, es, ed, d), so "flood" matches "floods" and "deforest" matches "deforested".
    Other scripts (e.g. Chinese) match as substrings.
    """
    t = term.casefold().strip()
    if t.isascii():
        m = re.search(rf"(?<!\w){re.escape(t)}(?:s|es|ed|d)?(?!\w)", hay)
        return m.start() if m else -1
    return hay.find(t)


# --- Loading --------------------------------------------------------------------------------


@dataclass
class CheckResult:
    kb: KnowledgeBase | None
    errors: list[str]
    warnings: list[str]
    counts: dict[str, int] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors


def load_knowledge(root: Path | None = None) -> KnowledgeBase:
    """Load and validate the knowledge base; raise ``KnowledgeError`` listing every problem."""
    result = check_knowledge(root)
    if result.errors or result.kb is None:
        raise KnowledgeError(result.errors, result.warnings)
    return result.kb


def check_knowledge(root: Path | None = None) -> CheckResult:
    """Load and validate without raising. ``kb`` is None when there are errors."""
    root = Path(root) if root is not None else PACKAGE_DIR
    v = _Validator(root)
    v.run()
    counts = {
        "events": len(v.events),
        "settings": len(v.settings),
        "rules": len(v.policy.rules),
        "templates": len(v.policy.templates),
        "tests": len(v.policy.tests),
    }
    if v.errors:
        return CheckResult(None, v.errors, v.warnings, counts)
    kb = KnowledgeBase(
        events=v.events,
        settings=v.settings,
        policy=v.policy,
        bodies=v.bodies,
        warnings=v.warnings,
        root=root,
    )
    return CheckResult(kb, [], v.warnings, counts)


class _Validator:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.events: dict[str, EventCard] = {}
        self.settings: dict[str, SettingCard] = {}
        self.bodies: dict[str, str] = {}
        self.paths: dict[str, str] = {}  # card id -> relative path
        self.policy = Policy()
        # Ids seen in headers, even when the card failed validation, so one broken card
        # does not cascade into "unknown id" errors in every card that links to it.
        self.event_ids: set[str] = set()
        self.setting_ids: set[str] = set()

    def err(self, rel: str, msg: str) -> None:
        self.errors.append(f"{rel}: {msg}")

    def warn(self, rel: str, msg: str) -> None:
        self.warnings.append(f"{rel}: {msg}")

    def rel(self, path: Path) -> str:
        try:
            return path.relative_to(self.root).as_posix()
        except ValueError:
            return str(path)

    def run(self) -> None:
        raw_events = self._read_folder("events", "event")
        raw_settings = self._read_folder("settings", "setting")
        for rel, header, body in raw_events:
            self._build(rel, header, body, EventCard, self.events)
        for rel, header, body in raw_settings:
            self._build(rel, header, body, SettingCard, self.settings)
        for eid, card in self.events.items():
            self._check_event(self.paths[eid], card)
        self._check_symmetry()
        for sid, card in self.settings.items():
            self._check_setting(self.paths[sid], card)
        self._load_policy()

    # Reading ----------------------------------------------------------------------------

    def _read_folder(self, folder: str, expected_type: str) -> list[tuple[str, dict, str]]:
        d = self.root / folder
        if not d.is_dir():
            self.err(folder + "/", "folder is missing")
            return []
        out = []
        for path in sorted(d.glob("*.md")):
            rel = self.rel(path)
            try:
                header, body = parse_card(path)
            except (CardParseError, OSError, UnicodeDecodeError) as exc:
                self.err(rel, str(exc))
                continue
            card_id = header.get("id")
            if card_id != path.stem:
                self.err(rel, f"id '{card_id}' must equal the file name '{path.stem}'")
            if isinstance(card_id, str):
                if card_id in self.paths:
                    self.err(rel, f"duplicate id '{card_id}' (also in {self.paths[card_id]})")
                    continue
                self.paths[card_id] = rel
                (self.event_ids if folder == "events" else self.setting_ids).add(card_id)
            if header.get("type") != expected_type:
                self.err(
                    rel,
                    f"type '{header.get('type')}' does not match folder {folder}/ "
                    f"(expected '{expected_type}')",
                )
                continue
            if not isinstance(card_id, str):
                continue
            out.append((rel, header, body))
        return out

    def _build(
        self,
        rel: str,
        header: dict,
        body: str,
        model: type[EventCard] | type[SettingCard],
        into: dict,
    ) -> None:
        try:
            card = model.model_validate(header)
        except ValidationError as exc:
            self.errors.extend(_pydantic_errors(rel, exc))
            return
        into[card.id] = card
        self.bodies[card.id] = body
        sections = EVENT_SECTIONS if model is EventCard else SETTING_SECTIONS
        headings = {line.strip() for line in body.splitlines()}
        for s in sections:
            if s not in headings:
                self.err(rel, f"body is missing the section heading '{s}'")

    # Events -----------------------------------------------------------------------------

    def _measure(self, rel: str, where: str, measure: str) -> bool:
        if measure not in ALL_MEASURES:
            self.err(
                rel, f"{where}: unknown measure '{measure}' (allowed: {', '.join(ALL_MEASURES)})"
            )
            return False
        return True

    def _check_event(self, rel: str, c: EventCard) -> None:
        for i, sid in enumerate(c.occurs_in):
            if sid != "any" and sid not in self.setting_ids:
                self.err(rel, f"occurs_in.{i}: '{sid}' is not a setting id or 'any'")

        for i, t in enumerate(c.triggered_by):
            if t.event is not None and t.event not in self.event_ids:
                self.err(rel, f"triggered_by.{i}.event: unknown event '{t.event}'")
            if t.measure is not None:
                self._measure(rel, f"triggered_by.{i}", t.measure)

        core = 0
        for i, s in enumerate(c.signs):
            if not self._measure(rel, f"signs.{i}", s.measure):
                continue
            if s.measure in MEASURES_PLANNED and not s.optional:
                self.err(
                    rel,
                    f"signs.{i}: measure '{s.measure}' is planned (may be unavailable), "
                    "so the sign must be optional: true",
                )
            if not s.optional and s.measure in MEASURES_V1 + MEASURES_CONTEXT:
                core += 1
        if core < 2:
            self.err(
                rel,
                f"needs at least 2 non-optional signs using v1 or context measures (has {core})",
            )

        total = sum(s.weight for s in c.signs)
        hi, med = c.confidence.high_min_weight, c.confidence.medium_min_weight
        if hi <= med:
            self.err(rel, f"confidence.high_min_weight ({hi}) must be > medium_min_weight ({med})")
        if hi > total or med > total:
            self.err(rel, f"confidence weights ({hi}/{med}) exceed the total sign weight ({total})")

        for i, la in enumerate(c.looks_like):
            if la.event == c.id:
                self.err(rel, f"looks_like.{i}: an event cannot list itself")
            elif la.event not in self.event_ids:
                self.err(rel, f"looks_like.{i}.event: unknown event '{la.event}'")
            for m in la.discriminating_measures:
                self._measure(rel, f"looks_like.{i}.discriminating_measures", m)
        seen = [la.event for la in c.looks_like]
        for dup in sorted({e for e in seen if seen.count(e) > 1}):
            self.err(rel, f"looks_like lists '{dup}' more than once")

        if len(c.cannot_tell) < 2:
            self.err(rel, f"cannot_tell needs at least 2 items (has {len(c.cannot_tell)})")

        if c.id in WORDING_REQUIRED and (c.wording is None or not c.wording.avoid):
            self.err(rel, "wording with 'use' and 'avoid' phrases is required for this event")

        for group in ("cases", "controls"):
            items = getattr(c, group)
            if not items:
                self.warn(rel, f"no {group} listed")
            for i, case in enumerate(items):
                if case.verified and not (case.url or "").startswith("https://"):
                    self.err(rel, f"{group}.{i}: verified: true needs an https url")
        for i, case in enumerate(c.cases):
            if case.expected != "detected":
                self.err(rel, f"cases.{i}: expected must be 'detected'")
        for i, case in enumerate(c.controls):
            if case.expected != "not_detected":
                self.err(rel, f"controls.{i}: expected must be 'not_detected'")

    def _check_symmetry(self) -> None:
        links = {eid: {la.event for la in c.looks_like} for eid, c in self.events.items()}
        for a, targets in sorted(links.items()):
            for b in sorted(targets):
                if b in links and a not in links[b]:
                    self.err(
                        self.paths[a],
                        f"looks_like lists '{b}' but events/{b}.md does not list '{a}' "
                        "(look-alikes must be symmetric)",
                    )

    # Settings ---------------------------------------------------------------------------

    def _codes(self, rel: str, where: str, codes: list[int]) -> None:
        for code in codes:
            if code not in WORLDCOVER_CODES:
                self.err(rel, f"{where}: {code} is not an ESA WorldCover class code")

    def _check_setting(self, rel: str, s: SettingCard) -> None:
        self._codes(rel, "worldcover_classes", s.worldcover_classes)
        self._codes(rel, "detect.land_cover_any", s.detect.land_cover_any)
        for i, n in enumerate(s.normal):
            self._measure(rel, f"normal.{i}", n.measure)
            if (
                n.typical_min is not None
                and n.typical_max is not None
                and n.typical_min > n.typical_max
            ):
                self.err(rel, f"normal.{i}: typical_min > typical_max")
        for i, eid in enumerate(s.likely_events):
            if eid not in self.event_ids:
                self.err(rel, f"likely_events.{i}: unknown event '{eid}'")
        # Settings and events must agree: a setting's likely_events and each event's
        # occurs_in ("any" covers every setting). Warn on drift in either direction.
        for eid in s.likely_events:
            ev = self.events.get(eid)
            if ev is not None and "any" not in ev.occurs_in and s.id not in ev.occurs_in:
                self.warn(
                    rel,
                    f"likely_events lists '{eid}' but events/{eid}.md occurs_in "
                    f"does not list '{s.id}'",
                )
        for eid, ev in sorted(self.events.items()):
            if s.id in ev.occurs_in and eid not in s.likely_events:
                self.warn(
                    rel,
                    f"events/{eid}.md occurs_in lists '{s.id}' but likely_events "
                    f"does not list '{eid}'",
                )

    # Policy -----------------------------------------------------------------------------

    def _yaml_file(self, name: str, model: type[BaseModel]) -> BaseModel | None:
        path = self.root / "policy" / name
        rel = self.rel(path)
        if not path.is_file():
            self.err(rel, "file is missing")
            return None
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except (yaml.YAMLError, OSError, UnicodeDecodeError) as exc:
            self.err(rel, f"not valid YAML: {_one_line(str(exc))}")
            return None
        try:
            return model.model_validate(data)
        except ValidationError as exc:
            self.errors.extend(_pydantic_errors(rel, exc))
            return None

    def _load_policy(self) -> None:
        rules = self._yaml_file("rules.yaml", RulesFile)
        templates = self._yaml_file("templates.yaml", TemplatesFile)
        tests = self._yaml_file("tests.yaml", TestsFile)
        rules_rel, tests_rel, tpl_rel = (
            "policy/rules.yaml",
            "policy/tests.yaml",
            "policy/templates.yaml",
        )

        rule_list = rules.rules if isinstance(rules, RulesFile) else []
        tpl_map = templates.templates if isinstance(templates, TemplatesFile) else {}
        case_list = tests.cases if isinstance(tests, TestsFile) else []

        actions: dict[str, str] = {}
        for i, r in enumerate(rule_list):
            if r.id in actions:
                self.err(rules_rel, f"rules.{i}: duplicate rule id '{r.id}'")
            actions[r.id] = r.action
            if isinstance(templates, TemplatesFile) and r.reply not in tpl_map:
                self.err(rules_rel, f"rules.{i} ({r.id}): reply template '{r.reply}' not found")
            if r.action == "block" and r.alternatives:
                self.err(
                    rules_rel, f"rules.{i} ({r.id}): block rules must have alternatives: false"
                )
        if isinstance(rules, RulesFile):
            for rid in REQUIRED_RULES:
                if rid not in actions:
                    self.warn(rules_rel, f"required rule '{rid}' is missing")

        if isinstance(rules, RulesFile):
            for i, case in enumerate(case_list):
                if case.expected_rule is None:
                    if case.expected_action != "allow":
                        self.warn(tests_rel, f"cases.{i}: no rule expected but action is not allow")
                elif case.expected_rule not in actions:
                    self.err(tests_rel, f"cases.{i}: unknown rule '{case.expected_rule}'")
                elif case.expected_action != actions[case.expected_rule]:
                    self.warn(
                        tests_rel,
                        f"cases.{i}: expected_action '{case.expected_action}' differs from "
                        f"rule '{case.expected_rule}' action '{actions[case.expected_rule]}'",
                    )

        used = {r.reply for r in rule_list}
        for tid in tpl_map:
            if tid not in used:
                self.warn(tpl_rel, f"template '{tid}' is not used by any rule")

        self.policy = Policy(rules=rule_list, templates=tpl_map, tests=case_list)
