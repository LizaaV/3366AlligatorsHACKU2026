"""Skills registry (HANDOFF B5, BUILD-PLAN A3/S1): reusable sandbox scripts the agent can run.

A skill is a folder `backend/skills/<id>/` with:

- `SKILL.md`: YAML front matter (same `---` convention as knowledge cards) + Markdown body
  with "## What it does", "## When to use it" and "## Limits";
- `run.py`: a sandbox script (`def run(**params)`, public `earth` calls only);
- `tests.yaml`: cases (references to knowledge card cases + preset expectations).

The model picks a skill by id and fills its params (`run_skill`); code validates the params
(`prepare_params`), injects the harness-owned ones (`area`, `name`), runs the script in the
sandbox (`run_skill_script`) and maps its findings to the FINDINGS CONVENTION
(`adapt_findings`), so scoring always reads `findings["observed"]`.
"""

from __future__ import annotations

import ast
import functools
import inspect
import logging
import math
import re
from collections.abc import Awaitable, Callable, Iterable, Mapping
from datetime import date
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

import earth
from app.services.sandbox import RunOutcome, run_script, scan_script
from earth.blocks import BLOCK_TYPES
from earth.types import EarthCall
from knowledge import ALL_MEASURES, CardParseError, KnowledgeBase, parse_card

__all__ = [
    "AUTO_PARAMS",
    "ECHOED_INPUTS",
    "OBSERVED_KEYS",
    "SKILLS_DIR",
    "Skill",
    "SkillError",
    "SkillNotFound",
    "SkillParam",
    "SkillParamError",
    "adapt_findings",
    "all_skills",
    "check_skill",
    "clear_cache",
    "get_skill",
    "get_skill_script",
    "observed_entry",
    "prepare_params",
    "run_skill_script",
    "script_params",
    "skill_ids",
    "skills_index_text",
]

log = logging.getLogger(__name__)

#: `backend/skills/`.
SKILLS_DIR = Path(__file__).resolve().parents[3] / "skills"
#: Skill ids are folder names: lowercase, digits and dashes (also blocks path tricks).
SKILL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
#: Params the harness sets itself; the model must not pass them.
AUTO_PARAMS: tuple[str, ...] = ("area", "name")
#: Keys of one `findings["observed"][measure]` entry (FINDINGS CONVENTION).
OBSERVED_KEYS: tuple[str, ...] = (
    "value",
    "before",
    "after",
    "delta",
    "inside_band",
    "local",
    "persistent",
    "sudden",
    "date",
)
#: Body sections every SKILL.md needs (HANDOFF B5.2).
SKILL_SECTIONS: tuple[str, ...] = ("## What it does", "## When to use it", "## Limits")

ParamType = Literal["area", "string", "int", "float", "bool", "date", "object"]
_MAX_STRING = 500


class SkillError(Exception):
    """A skill is missing or its files are invalid."""


class SkillNotFound(SkillError):
    """No skill with this id."""


class SkillParamError(SkillError):
    """The params given for a skill are invalid. `hint` says what to send instead."""

    def __init__(self, message: str, hint: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.hint = hint


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SkillParam(_Strict):
    """One parameter of a skill's `run(**params)`, as declared in SKILL.md."""

    type: ParamType
    description: str | None = None
    default: Any = None
    required: bool = False
    auto: bool = Field(False, description="Set by the harness (area, name), never by the model.")
    min: float | None = None
    max: float | None = None
    max_km2: float | None = Field(None, gt=0, description="For `area`: largest outline allowed.")


class _SkillHeader(_Strict):
    id: str
    version: int = Field(ge=1)
    status: Literal["draft", "tested", "reviewed"]
    name: str
    summary: str
    tests_events: list[str] = Field(min_length=1)
    considers: list[str] = Field(default_factory=list)
    params: dict[str, SkillParam]
    needs: list[str] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    timeout_s: int | None = Field(
        None,
        ge=10,
        le=600,
        description="Sandbox time limit for one run of the skill (seconds); the agent's "
        "default for scripts when not set. Always capped by the run's time left.",
    )


class Skill(_SkillHeader):
    """A skill: its SKILL.md header, body and run.py source."""

    body: str
    script: str

    @property
    def model_params(self) -> dict[str, SkillParam]:
        """Params the model may fill (not set by the harness)."""
        return {k: p for k, p in self.params.items() if not p.auto}


# --- Loading ------------------------------------------------------------------------------------


def _root(root: Path | None) -> Path:
    return Path(root) if root is not None else SKILLS_DIR


def skill_ids(root: Path | None = None) -> list[str]:
    """Ids of the skill folders that have both SKILL.md and run.py, sorted."""
    base = _root(root)
    if not base.is_dir():
        return []
    return sorted(
        d.name
        for d in base.iterdir()
        if d.is_dir()
        and SKILL_ID_RE.fullmatch(d.name)
        and (d / "SKILL.md").is_file()
        and (d / "run.py").is_file()
    )


def _check_id(skill_id: object) -> str:
    if not isinstance(skill_id, str) or not SKILL_ID_RE.fullmatch(skill_id):
        raise SkillNotFound(f"unknown skill id: {skill_id!r}")
    return skill_id


@functools.cache
def _load(root: Path, skill_id: str) -> Skill:
    folder = root / skill_id
    if skill_id not in skill_ids(root):
        raise SkillNotFound(f"unknown skill id: {skill_id!r}")
    try:
        header, body = parse_card(folder / "SKILL.md")
        script = (folder / "run.py").read_text(encoding="utf-8")
    except (CardParseError, OSError, UnicodeDecodeError) as exc:
        raise SkillError(f"skills/{skill_id}: {exc}") from exc
    if header.get("id") != skill_id:
        raise SkillError(
            f"skills/{skill_id}/SKILL.md: id {header.get('id')!r} must equal the folder name"
        )
    try:
        return Skill.model_validate({**header, "body": body, "script": script})
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()
        )
        raise SkillError(f"skills/{skill_id}/SKILL.md: {problems}") from exc


def get_skill(skill_id: str, root: Path | None = None) -> Skill:
    """The skill with this id. Raises `SkillNotFound` (unknown or malformed id) or
    `SkillError` (invalid files). Cached; `clear_cache()` after editing skill files."""
    return _load(_root(root).resolve(), _check_id(skill_id))


def get_skill_script(skill_id: str, root: Path | None = None) -> str:
    """The skill's run.py source, for the sandbox."""
    return get_skill(skill_id, root).script


def all_skills(root: Path | None = None) -> list[Skill]:
    """Every loadable skill, sorted by id. Invalid ones are logged and left out."""
    out: list[Skill] = []
    for sid in skill_ids(root):
        try:
            out.append(get_skill(sid, root))
        except SkillError as exc:
            log.warning("skill %s skipped: %s", sid, exc)
    return out


def clear_cache() -> None:
    """Forget loaded skills (after editing skill files)."""
    _load.cache_clear()


# --- Prompt index -------------------------------------------------------------------------------


def _fmt_num(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:g}"


def _param_text(key: str, p: SkillParam) -> str:
    kind = "date YYYY-MM-DD" if p.type == "date" else p.type
    parts = [kind]
    if p.required:
        parts.append("required")
    else:
        parts.append(f"default {'null' if p.default is None else p.default}")
    if p.min is not None or p.max is not None:
        lo = _fmt_num(p.min) if p.min is not None else ""
        hi = _fmt_num(p.max) if p.max is not None else ""
        parts.append(f"{lo}..{hi}")
    text = f"{key} ({', '.join(parts)})"
    return f"{text}: {p.description}" if p.description else text


def skills_index_text(skills: Iterable[Skill] | None = None) -> str:
    """One compact block per skill for the system prompt (stable: sorted, no volatile data)."""
    items = sorted(all_skills() if skills is None else skills, key=lambda s: s.id)
    if not items:
        return "(no skills yet)"
    lines: list[str] = []
    for s in items:
        lines.append(f"- {s.id} ({s.name}) [{s.status} v{s.version}]: {s.summary}")
        lines.append(f"  tests: {', '.join(s.tests_events)}")
        if s.considers:
            lines.append(f"  also weighs: {', '.join(s.considers)}")
        own = [_param_text(k, p) for k, p in s.model_params.items()]
        lines.append("  params_json keys:" + ("" if own else " none"))
        lines += [f"    {text}" for text in own]
        auto = [k for k, p in s.params.items() if p.auto]
        if auto:
            area = s.params.get("area")
            needs = " (needs an outline)" if area is not None and area.required else ""
            lines.append(f"  set by the harness: {', '.join(auto)}{needs}")
        if s.outputs:
            lines.append(f"  blocks: {', '.join(s.outputs)}")
    return "\n".join(lines)


# --- Params -------------------------------------------------------------------------------------


def _is_number(v: object) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v)


def _range_text(p: SkillParam) -> str:
    if p.min is not None and p.max is not None:
        return f" between {_fmt_num(p.min)} and {_fmt_num(p.max)}"
    if p.min is not None:
        return f" of at least {_fmt_num(p.min)}"
    if p.max is not None:
        return f" of at most {_fmt_num(p.max)}"
    return ""


def _check_value(key: str, p: SkillParam, value: Any) -> Any:
    shown = repr(value)[:60]
    expected = {
        "int": "a whole number",
        "float": "a number",
        "string": "a string",
        "bool": "true or false",
        "date": 'a date "YYYY-MM-DD"',
        "object": "a JSON object",
        "area": "a GeoJSON object",
    }[p.type]
    bad = SkillParamError(
        f"Param '{key}' must be {expected}{_range_text(p)}, got {shown}.",
        p.description,
    )
    if p.type == "int":
        if not _is_number(value) or not float(value).is_integer():
            raise bad
        value = int(value)
    elif p.type == "float":
        if not _is_number(value):
            raise bad
        value = float(value)
    elif p.type == "string":
        if not isinstance(value, str) or len(value) > _MAX_STRING:
            raise bad
    elif p.type == "bool":
        if not isinstance(value, bool):
            raise bad
    elif p.type == "date":
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise bad
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise bad from exc
    elif p.type in ("object", "area") and not isinstance(value, dict):
        raise bad
    if p.type in ("int", "float") and (
        (p.min is not None and value < p.min) or (p.max is not None and value > p.max)
    ):
        raise bad
    return value


def prepare_params(
    skill: Skill,
    params: Mapping[str, Any] | None,
    *,
    area: dict | None,
    name: str | None,
) -> dict[str, Any]:
    """Validate the model's params for `skill` and add the harness-owned ones.

    - Unknown keys, harness-owned keys (`area`, `name`), wrong types and out-of-range values
      raise `SkillParamError` (its message and hint go back to the model as a tool error).
    - A null value means "use the script's default" and is left out.
    - `area` (GeoJSON) and `name` come from the run, never from the model. A skill whose
      `area` is required refuses to run without one, so a skill can never fall back to a
      demo preset area on a real run.
    """
    given = dict(params or {})
    own = skill.model_params
    hint = "Params for this skill: " + (", ".join(sorted(own)) or "none") + "."
    unknown = sorted(k for k in given if k not in skill.params)
    if unknown:
        raise SkillParamError(f"Unknown param(s) for {skill.id}: {', '.join(unknown)}.", hint)
    owned = sorted(k for k in given if skill.params[k].auto)
    if owned:
        raise SkillParamError(
            f"{', '.join(owned)} {'is' if len(owned) == 1 else 'are'} set by the harness; "
            "leave it out of params_json.",
            hint,
        )
    out: dict[str, Any] = {}
    for key, p in own.items():
        value = given.get(key)
        if value is None:
            if p.required:
                raise SkillParamError(f"Param '{key}' is required for {skill.id}.", hint)
            continue
        out[key] = _check_value(key, p, value)

    harness = {"area": area, "name": name}
    for key, p in skill.params.items():
        if not p.auto:
            continue
        if key not in harness:
            raise SkillError(f"skills/{skill.id}: auto param '{key}' is not one of {AUTO_PARAMS}")
        value = harness[key]
        if value is None:
            if p.required:
                raise SkillParamError(
                    f"{skill.id} needs an outline of the place, and this run has none.",
                    "Ask the user to pick or draw the place, or find it with "
                    "earth.search_places() in run_code.",
                )
            continue
        if p.type == "area":
            value = _check_area(skill, p, value)
        elif p.type == "string":
            value = str(value)[:200]
        out[key] = value
    return out


def _check_area(skill: Skill, p: SkillParam, geojson: Any) -> dict:
    if not isinstance(geojson, dict):
        raise SkillParamError(f"{skill.id} needs the area as GeoJSON.")
    if p.max_km2 is not None:
        try:
            ha = earth.Area.from_geojson(geojson).area_ha
        except earth.EarthError as exc:
            raise SkillParamError(f"The outline is not usable: {exc.message}", exc.hint) from exc
        if ha > p.max_km2 * 100:
            raise SkillParamError(
                f"The outline is {ha:.0f} ha; {skill.id} takes at most "
                f"{_fmt_num(p.max_km2 * 100)} ha.",
                "Ask for a smaller outline, or use run_code.",
            )
    return geojson


# --- Script inspection --------------------------------------------------------------------------


def _literal(node: ast.expr | None) -> Any:
    if node is None:
        return None
    try:
        return ast.literal_eval(node)
    except (ValueError, SyntaxError, TypeError):
        return ast.unparse(node)


def script_params(script: str) -> dict[str, Any]:
    """The params a script's `run` reads → their default (`inspect.Parameter.empty` = none).

    Reads explicit arguments of `def run(...)` and, for `**params`, every `params.get("k",
    default)` and `params["k"]` in the module (helpers that take the same `params` dict
    count). Raises `SkillError` if there is no top-level `run`.
    """
    tree = ast.parse(script)
    run = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run"), None)
    if run is None:
        raise SkillError("no top-level def run(...)")
    out: dict[str, Any] = {}
    args = run.args
    positional = args.posonlyargs + args.args
    defaults = [None] * (len(positional) - len(args.defaults)) + list(args.defaults)
    for arg, default in zip(positional, defaults, strict=True):
        out[arg.arg] = inspect.Parameter.empty if default is None else _literal(default)
    for arg, default in zip(args.kwonlyargs, args.kw_defaults, strict=True):
        out[arg.arg] = inspect.Parameter.empty if default is None else _literal(default)
    if args.kwarg is None:
        return out

    kw = args.kwarg.arg
    got: dict[str, Any] = {}
    subscripted: set[str] = set()
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "get"
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == kw
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            key = node.args[0].value
            default = _literal(node.args[1]) if len(node.args) > 1 else None
            if got.get(key) is None:
                got[key] = default
        elif (
            isinstance(node, ast.Subscript)
            and isinstance(node.value, ast.Name)
            and node.value.id == kw
            and isinstance(node.slice, ast.Constant)
            and isinstance(node.slice.value, str)
        ):
            subscripted.add(node.slice.value)
    for key in sorted(subscripted - set(got)):
        out.setdefault(key, inspect.Parameter.empty)
    for key, default in got.items():
        out.setdefault(key, default)
    return out


def check_skill(skill: Skill, kb: KnowledgeBase | None = None) -> list[str]:
    """Every problem with a skill (empty = valid): body sections, params vs run.py, sandbox
    scan, block types, and (with `kb`) that its events are knowledge cards."""
    where = f"skills/{skill.id}"
    problems: list[str] = []
    headings = {line.strip() for line in skill.body.splitlines()}
    problems += [
        f"{where}/SKILL.md: body is missing '{s}'" for s in SKILL_SECTIONS if s not in headings
    ]

    scan = scan_script(skill.script)
    if scan is not None:
        problems.append(f"{where}/run.py: {scan.message}")
    try:
        found = script_params(skill.script)
    except (SkillError, SyntaxError) as exc:
        found = {}
        problems.append(f"{where}/run.py: {exc}")
    for key in sorted(set(skill.params) - set(found)):
        problems.append(f"{where}: param '{key}' is declared but run.py never reads it")
    for key in sorted(set(found) - set(skill.params)):
        problems.append(f"{where}: run.py reads '{key}' but SKILL.md does not declare it")
    for key, p in skill.params.items():
        if p.auto and key not in AUTO_PARAMS:
            problems.append(f"{where}: auto param '{key}' must be one of {AUTO_PARAMS}")
        if p.min is not None and p.max is not None and p.min > p.max:
            problems.append(f"{where}: param '{key}' has min > max")
        if key in found and not p.required:
            script_default = found[key]
            if script_default is inspect.Parameter.empty:
                problems.append(f"{where}: param '{key}' has no default in run.py")
            elif script_default != p.default:
                problems.append(
                    f"{where}: param '{key}' default {p.default!r} differs from run.py's "
                    f"{script_default!r}"
                )
        if not p.required and not p.auto and p.default is not None:
            try:
                _check_value(key, p, p.default)
            except SkillParamError as exc:
                problems.append(f"{where}: default of '{key}': {exc.message}")

    problems += [
        f"{where}: output '{o}' is not a block type ({', '.join(BLOCK_TYPES)})"
        for o in skill.outputs
        if o not in BLOCK_TYPES
    ]
    if kb is not None:
        for group in ("tests_events", "considers"):
            problems += [
                f"{where}: {group} '{e}' is not an event card"
                for e in getattr(skill, group)
                if e not in kb.events
            ]
    return problems


# --- Findings (FINDINGS CONVENTION) -------------------------------------------------------------


def observed_entry(**values: Any) -> dict[str, Any]:
    """One `findings["observed"][measure]` entry with every key present (unknown = None)."""
    unknown = sorted(set(values) - set(OBSERVED_KEYS))
    if unknown:
        raise ValueError(f"not observed keys: {unknown}")
    return {k: values.get(k) for k in OBSERVED_KEYS}


def _num(x: object) -> float | None:
    return float(x) if _is_number(x) else None


def _legacy_observed(findings: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Map findings written before the convention (pond-filling-check v1) to `observed`.

    Reads per-measure `{before, after, delta}` (or `value`) dicts, `change_dates`,
    `local_vs_regional` and `persistence`. A change date means the series left the usual
    range and stayed out, so `inside_band` is False then; otherwise it is unknown.
    """
    change_dates = findings.get("change_dates") or {}
    lvr = findings.get("local_vs_regional") or {}
    persistence = findings.get("persistence") or {}
    observed: dict[str, dict[str, Any]] = {}
    for m in ALL_MEASURES:
        raw = findings.get(m)
        if not isinstance(raw, Mapping):
            continue
        before, after = _num(raw.get("before")), _num(raw.get("after"))
        value = _num(raw.get("value"))
        if value is None:
            value = after
        delta = _num(raw.get("delta"))
        if delta is None and before is not None and after is not None:
            delta = round(after - before, 4)
        if value is None and delta is None:
            continue
        when = change_dates.get(m) if isinstance(change_dates, Mapping) else None
        verdict = (lvr.get(m) or {}).get("verdict") if isinstance(lvr, Mapping) else None
        local = {"local": True, "regional": False}.get(verdict) if verdict else None
        persistent = None
        if m == "water" and isinstance(persistence, Mapping):
            if persistence.get("persists") is True:
                persistent = True
            elif (persistence.get("later_scenes") or 0) >= 3:
                persistent = False
        observed[m] = observed_entry(
            value=value,
            before=before,
            after=after,
            delta=delta,
            inside_band=False if when else None,
            local=local,
            persistent=persistent,
            date=when if isinstance(when, str) else None,
        )
    return observed


#: Skill id → adapter for skills whose findings predate the convention.
_ADAPTERS: dict[str, Callable[[Mapping[str, Any]], dict[str, dict[str, Any]]]] = {
    "pond-filling-check": _legacy_observed,
}


#: Inputs a skill echoes back into its findings. Dropped: clarification answers can hold
#: remembered profile values, which must not flow into tool results or step text.
ECHOED_INPUTS: tuple[str, ...] = ("answers",)


def adapt_findings(skill_id: str, findings: Mapping[str, Any]) -> dict[str, Any]:
    """`findings` with a `findings["observed"]` dict (FINDINGS CONVENTION), as a new dict.

    An existing `observed` dict is kept as it is; otherwise the skill's adapter (or the
    generic one) builds it from the other keys, which are kept. Echoed inputs
    (`ECHOED_INPUTS`) are removed either way.
    """
    out = {k: v for k, v in findings.items() if k not in ECHOED_INPUTS}
    if not isinstance(out.get("observed"), dict):
        out["observed"] = _ADAPTERS.get(skill_id, _legacy_observed)(out)
    return out


# --- Running ------------------------------------------------------------------------------------


async def run_skill_script(
    skill_id: str,
    params: dict[str, Any],
    run_id: str,
    on_call: Callable[[EarthCall], Awaitable[None]] | None = None,
    timeout_s: int = 60,
    root: Path | None = None,
) -> RunOutcome:
    """Run a skill's run.py in the sandbox with already-prepared params (`prepare_params`);
    a successful result's findings are passed through `adapt_findings`."""
    outcome = await run_script(
        get_skill_script(skill_id, root), params, run_id, on_call=on_call, timeout_s=timeout_s
    )
    if outcome.ok and outcome.result is not None:
        findings = adapt_findings(skill_id, outcome.result.findings)
        result = outcome.result.model_copy(update={"findings": findings})
        outcome = outcome.model_copy(update={"result": result})
    return outcome
