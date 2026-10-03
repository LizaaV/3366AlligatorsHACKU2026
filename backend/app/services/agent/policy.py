"""Code gates that run before the guard and the loop (HANDOFF B7.4 step 0, B8, B11.2).

No LLM here; every check is plain code:

- **Cooldown** per user (in memory): `check_cooldown` raises `CooldownActive` with
  `retry_after` when the same user starts runs faster than `settings.run_cooldown_s`.
- **Daily spend cap**: `check_spend_cap` raises `SpendCapReached` when the cost of today's
  runs (UTC midnight onwards, all users) is at or over `settings.daily_spend_cap_usd`.
- **Prompt-injection pre-check**: `injection_precheck` catches blatant override,
  prompt-leak, key-exfiltration and code-execution attempts with regexes, so they map to
  the `prompt_injection` rule without an LLM call. It is deliberately narrow: anything
  subtle is left to the guard (a false positive here blocks a real question).
- **Area gates**: `military_overlap` (pluggable; `rules.yaml` `military_targeting` checks
  `area_overlaps_osm landuse=military`) and `size_gate` (the `max_area_km2` / `min_area_ha`
  checks in `rules.yaml`).
- **Cleaning** (B8 layer 2): `clean_text` / `clean_facts` cap and strip untrusted text
  (place names, OSM tags) before it goes into a prompt as data.

`run_gates(user_id)` is the usual entry point: spend cap first (no side effect), then the
cooldown (which records the start).
"""

from __future__ import annotations

import logging
import math
import re
import threading
import time
import unicodedata
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.core.config import settings
from app.services import runs as run_store
from knowledge import KnowledgeBase

__all__ = [
    "INJECTION_RULE",
    "MAX_ACTIVE_RUNS",
    "MILITARY_RULE",
    "RUN_SLOTS",
    "CooldownActive",
    "Cooldowns",
    "InjectionHit",
    "MilitaryCheck",
    "PolicyGateError",
    "PolicyHit",
    "RunSlots",
    "SpendCapReached",
    "TooManyRuns",
    "check_cooldown",
    "check_run_slots",
    "check_spend_cap",
    "clean_facts",
    "clean_text",
    "injection_hit",
    "injection_precheck",
    "military_overlap",
    "reset_cooldowns",
    "reset_rates",
    "check_rates",
    "client_address",
    "RateLimited",
    "SlidingWindow",
    "run_gates",
    "set_military_check",
    "size_gate",
    "utc_midnight",
]

log = logging.getLogger(__name__)

#: Policy rule ids the gates map to (must exist in `knowledge/policy/rules.yaml`).
INJECTION_RULE = "prompt_injection"
MILITARY_RULE = "military_targeting"


# --- Errors ---------------------------------------------------------------------------------


class PolicyGateError(Exception):
    """A code gate refused to start a run. `code` is stable for the API layer."""

    code: str = "policy_gate"

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class CooldownActive(PolicyGateError):
    """The same user started a run less than `settings.run_cooldown_s` ago."""

    code = "cooldown"

    def __init__(self, retry_after: float) -> None:
        self.retry_after = max(0.0, retry_after)
        super().__init__(f"Please wait {math.ceil(self.retry_after)} s before the next question.")


class SpendCapReached(PolicyGateError):
    """Today's LLM spend reached `settings.daily_spend_cap_usd` (presets-only mode)."""

    code = "spend_cap"

    def __init__(self, spent_usd: float, cap_usd: float) -> None:
        self.spent_usd = spent_usd
        self.cap_usd = cap_usd
        super().__init__(
            "The daily budget for new analyses is used up; the demo presets still work."
        )


@dataclass(frozen=True)
class PolicyHit:
    """A code gate matched a policy rule (turned into a guard result by `guard.py`)."""

    rule_id: str
    reason: str
    source: Literal["precheck", "military", "size"]


# --- Cooldown -------------------------------------------------------------------------------


class Cooldowns:
    """Per-user minimum gap between run starts, in memory (one process, hackathon scale)."""

    _PRUNE_AT = 10_000  # users tracked before old entries are dropped

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._last: dict[str, float] = {}
        self._lock = threading.Lock()

    def check(self, user_id: str, cooldown_s: float | None = None) -> None:
        """Record a run start for `user_id`, or raise CooldownActive if it is too soon.

        A refused start is not recorded, so waiting `retry_after` always works.
        """
        gap = settings.run_cooldown_s if cooldown_s is None else cooldown_s
        if gap <= 0:
            return
        now = self._clock()
        with self._lock:
            last = self._last.get(user_id)
            if last is not None and now - last < gap:
                raise CooldownActive(retry_after=gap - (now - last))
            self._last[user_id] = now
            if len(self._last) > self._PRUNE_AT:
                self._last = {u: t for u, t in self._last.items() if now - t < gap}

    def reset(self, user_id: str | None = None) -> None:
        """Forget one user's last start (or everyone's)."""
        with self._lock:
            if user_id is None:
                self._last.clear()
            else:
                self._last.pop(user_id, None)


_COOLDOWNS = Cooldowns()


def check_cooldown(user_id: str) -> None:
    """Process-wide cooldown for `user_id` (see `Cooldowns.check`)."""
    _COOLDOWNS.check(user_id)


def reset_cooldowns() -> None:
    """Clear the process-wide cooldowns (tests)."""
    _COOLDOWNS.reset()


# --- Hourly rate limits (anti-spam) --------------------------------------------------------


class RateLimited(PolicyGateError):
    """Too many runs started in the last hour by this user or from this address."""

    code = "rate_limited"

    def __init__(self, retry_after: float, scope: str) -> None:
        self.retry_after = max(1.0, retry_after)
        self.scope = scope
        super().__init__(
            f"Too many questions in the last hour; try again in {math.ceil(self.retry_after)} s."
        )


class SlidingWindow:
    """At most `limit` events per key in the last `window_s` seconds, in memory.

    One process, hackathon scale (like `Cooldowns`). Keys are user ids and client
    addresses, so changing `X-User-Id` alone does not escape the limit.
    """

    _PRUNE_AT = 10_000

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._events: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_s: float, scope: str) -> None:
        """Record one event for `key`, or raise RateLimited (a refused hit is not recorded)."""
        if limit <= 0:
            return
        now = self._clock()
        with self._lock:
            recent = [t for t in self._events.get(key, []) if now - t < window_s]
            if len(recent) >= limit:
                self._events[key] = recent
                raise RateLimited(retry_after=window_s - (now - recent[0]), scope=scope)
            recent.append(now)
            self._events[key] = recent
            if len(self._events) > self._PRUNE_AT:
                self._events = {
                    k: v for k, v in self._events.items() if v and now - v[-1] < window_s
                }

    def reset(self) -> None:
        with self._lock:
            self._events.clear()


_RATES = SlidingWindow()
_HOUR = 3600.0


def client_address(host: str | None, headers: Mapping[str, str]) -> str:
    """The caller's address: the socket peer, or the proxy's `X-Real-IP` / first
    `X-Forwarded-For` hop when `settings.trust_proxy_headers` (only behind our nginx)."""
    if settings.trust_proxy_headers:
        real = headers.get("x-real-ip") or headers.get("x-forwarded-for", "").split(",")[0]
        if real.strip():
            return real.strip()[:64]
    return (host or "unknown")[:64]


def check_rates(user_id: str, address: str) -> None:
    """Hourly caps on runs started (new questions and clarification replies) per user and
    per address. Raises RateLimited; nothing is recorded for a refused start."""
    _RATES.hit(f"addr:{address}", settings.runs_per_hour_per_ip, _HOUR, "address")
    _RATES.hit(f"user:{user_id}", settings.runs_per_hour_per_user, _HOUR, "user")


def reset_rates() -> None:
    """Clear the process-wide rate windows (tests)."""
    _RATES.reset()


# --- Spend cap ------------------------------------------------------------------------------


def utc_midnight(now: datetime | None = None) -> datetime:
    """The start of the current UTC day (naive `now` is taken as UTC)."""
    now = now or datetime.now(UTC)
    if now.tzinfo is None:
        now = now.replace(tzinfo=UTC)
    return now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def check_spend_cap(now: datetime | None = None) -> float:
    """Today's spend in USD, or raise SpendCapReached when it is at or over the cap.

    A cap of 0 (or less) therefore refuses every agent run: presets-only mode.
    """
    cap = settings.daily_spend_cap_usd
    spent = run_store.spent_usd_since(utc_midnight(now))
    if spent >= cap:
        log.warning("daily spend cap reached: %.2f >= %.2f USD", spent, cap)
        raise SpendCapReached(spent_usd=spent, cap_usd=cap)
    return spent


# --- Agent runs in flight -------------------------------------------------------------------

#: Agent runs (new or resumed) that may stream at once in this process. The spend cap only
#: sees cost already saved, so this bounds what concurrent starts can spend before it does.
MAX_ACTIVE_RUNS = 3


class TooManyRuns(PolicyGateError):
    """`MAX_ACTIVE_RUNS` agent runs are already streaming."""

    code = "busy"

    def __init__(self, retry_after: float = 10.0) -> None:
        self.retry_after = retry_after
        super().__init__("Several analyses are running right now; try again in a few seconds.")


class RunSlots:
    """A count of the agent runs streaming now (one process, hackathon scale)."""

    def __init__(self, limit: int = MAX_ACTIVE_RUNS) -> None:
        self.limit = limit
        self._active = 0
        self._lock = threading.Lock()

    @property
    def active(self) -> int:
        return self._active

    def check(self) -> None:
        """Raise TooManyRuns when every slot is taken (the route answers 429)."""
        with self._lock:
            if self._active >= self.limit:
                raise TooManyRuns()

    def enter(self) -> None:
        """Count a run as streaming (call `leave` when it ends, in a `finally`)."""
        with self._lock:
            self._active += 1

    def leave(self) -> None:
        with self._lock:
            self._active = max(0, self._active - 1)


RUN_SLOTS = RunSlots()


def check_run_slots() -> None:
    """Raise TooManyRuns when `MAX_ACTIVE_RUNS` agent runs are already streaming."""
    RUN_SLOTS.check()


def run_gates(user_id: str, now: datetime | None = None) -> None:
    """The gates before a new agent run: spend cap, then cooldown (which records the start)."""
    check_spend_cap(now)
    check_cooldown(user_id)


# --- Cleaning untrusted text (B8 layer 2) ---------------------------------------------------

_ZERO_WIDTH = dict.fromkeys(map(ord, "​‌‍⁠﻿­"))
_TAG_RE = re.compile(r"<[^<>]{0,200}>")
_SPACE_RE = re.compile(r"\s+")


def _normalise(text: str) -> str:
    """NFKC (full-width letters become ASCII), zero-width characters removed."""
    return unicodedata.normalize("NFKC", text).translate(_ZERO_WIDTH)


def clean_text(text: str, max_len: int = 200) -> str:
    """Untrusted text made safe to quote as data: no control characters or markup tags,
    whitespace collapsed, at most `max_len` characters (cut with an ellipsis)."""
    text = _normalise(text)
    text = "".join(" " if unicodedata.category(ch)[0] == "C" else ch for ch in text)
    text = _SPACE_RE.sub(" ", _TAG_RE.sub(" ", text)).strip()
    if len(text) > max_len:
        text = text[: max(0, max_len - 1)].rstrip() + "…"
    return text


def clean_facts(value: Any, *, max_str: int = 200, max_items: int = 20, depth: int = 3) -> Any:
    """A JSON-ready copy of `value` with every string cleaned (`clean_text`), lists and
    dicts cut to `max_items`, and nesting cut at `depth` (deeper values become strings)."""
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, str):
        return clean_text(value, max_str)
    if depth <= 0:
        return clean_text(str(value), max_str)
    if isinstance(value, Mapping):
        items = list(value.items())[:max_items]
        return {
            clean_text(str(k), 60): clean_facts(
                v, max_str=max_str, max_items=max_items, depth=depth - 1
            )
            for k, v in items
        }
    if isinstance(value, list | tuple | set | frozenset):
        return [
            clean_facts(v, max_str=max_str, max_items=max_items, depth=depth - 1)
            for v in list(value)[:max_items]
        ]
    return clean_text(str(value), max_str)


# --- Prompt-injection pre-check -------------------------------------------------------------

_I = re.IGNORECASE
_VERB = (
    r"(?:print|show|reveal|repeat|output|tell\s+me|display|leak|dump|share|send|give\s+me|"
    r"read|write\s+out|what\s+is|what's)"
)

#: (name, compiled pattern). Narrow on purpose: each one is something a real question about
#: a place does not contain. Matched against NFKC-normalised text.
_INJECTION_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "override_previous",
        re.compile(
            r"\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+)?(?:of\s+)?"
            r"(?:the\s+|your\s+|any\s+)?(?:previous|prior|above|earlier|preceding|system)\s+"
            r"(?:instructions?|prompts?|rules|messages|directions)\b",
            _I,
        ),
    ),
    (
        "override_your_rules",
        re.compile(
            r"\b(?:ignore|disregard|forget|override|bypass|skip|disable|turn\s+off|switch\s+off)"
            r"\s+(?:all\s+)?(?:of\s+)?your\s+(?:\w+\s+){0,2}(?:rules|instructions|guidelines|"
            r"polic(?:y|ies)|guard(?:rails?)?|checks|restrictions|filters|limits|safety|"
            r"programming)\b",
            _I,
        ),
    ),
    (
        "disable_guard",
        re.compile(
            r"\b(?:disable|turn\s+off|switch\s+off|bypass)\s+(?:the\s+)?(?:guard|guardrails?|"
            r"safety\s+(?:checks?|filters?|polic(?:y|ies))|content\s+filters?|policy\s+checks?)\b",
            _I,
        ),
    ),
    (
        "pretend_check_off",
        re.compile(
            r"\bpretend\b[^.\n]{0,60}\b(?:check|guard|rules?|filters?|polic(?:y|ies))\s+"
            r"(?:is|are)\s+(?:off|disabled|gone)\b",
            _I,
        ),
    ),
    (
        "prompt_leak",
        re.compile(
            rf"\b{_VERB}\b[^.\n]{{0,40}}\b(?:(?:system|developer|hidden|initial|original)\s+"
            r"(?:prompts?|instructions)|system\s+messages?)\b",
            _I,
        ),
    ),
    (
        "repeat_above",
        re.compile(
            r"\brepeat\s+(?:the\s+|all\s+)?(?:text|words|everything|instructions|lines)\s+"
            r"(?:above|before)\b|\bstarting\s+with\s+['\"‘“]?you\s+are\b",
            _I,
        ),
    ),
    (
        "secret_exfiltration",
        re.compile(
            rf"\b{_VERB}\b[^.\n]{{0,40}}\b(?:api[\s_-]?keys?|secret\s+keys?|access\s+tokens?|"
            r"environment\s+variables?|credentials|passwords?)\b"
            r"|\bANTHROPIC_API_KEY\b|\bos\.environ\b|(?:^|\s)\.env\s+file\b|/etc/passwd\b",
            _I,
        ),
    ),
    (
        "code_execution",
        re.compile(
            r"\bimport\s+(?:os|sys|subprocess|socket|requests|urllib|shutil|httpx)\b"
            r"|\bsubprocess\b|\brequests\.(?:get|post|put)\s*\(|\burllib\b|\bsocket\.\w+"
            r"|\b(?:eval|exec|__import__)\s*\(|\bopen\(\s*['\"]"
            r"|\bcurl\b[^\n]{0,40}https?://",
            _I,
        ),
    ),
    (
        "fake_role_marker",
        re.compile(
            r"\[(?:system|admin|developer|assistant)\]|<\|?(?:im_start|system)\|?>"
            r"|\bNOTE\s+TO\s+(?:THE\s+)?(?:AGENT|AI|ASSISTANT|MODEL|CLAUDE)\b"
            r"|(?:^|\n)\s*(?:system|developer)\s*:",
            _I,
        ),
    ),
    ("fake_system_upper", re.compile(r"\b(?:SYSTEM|ADMIN|DEVELOPER)\s*:")),
    (
        "jailbreak_mode",
        re.compile(
            r"\b(?:developer|god|jailbreak|unrestricted)\s+mode\b|\bjailbreak"
            r"|\byou\s+are\s+now\b[^.\n]{0,60}\b(?:no|without)\s+(?:restrictions|limits|rules|"
            r"filters)\b",
            _I,
        ),
    ),
    ("jailbreak_dan", re.compile(r"\b(?:[Yy]ou\s+are|[Aa]ct\s+as)\s+(?:now\s+)?DAN\b")),
    ("forge_guard_output", re.compile(r"\b(?:rule_id|expected_action|expected_rule)\b", _I)),
    (
        "card_status",
        re.compile(
            r"\b(?:mark|set|change|edit\w*|update|promote|flip)\b[^.\n]{0,60}\bcards?\b"
            r"[^.\n]{0,40}\b(?:reviewed|tested)\b",
            _I,
        ),
    ),
    (
        "change_caps",
        re.compile(
            r"\b(?:set|change|raise|increase|remove|disable|lift|turn\s+off)\s+your\s+"
            r"(?:\w+\s+){0,2}(?:limits?|caps?|budgets?)\b",
            _I,
        ),
    ),
    (
        "encoded_instruction",
        re.compile(
            r"\bbase64\b[^.\n]{0,30}\b(?:decode|follow|run|execute|obey)\b"
            r"|\b(?:decode|follow|run|execute|obey)\b[^.\n]{0,30}\bbase64\b",
            _I,
        ),
    ),
    (
        "authority_claim",
        re.compile(
            r"\b(?:i\s+am|i'm|we\s+are|we're|this\s+is)\s+(?:from\s+)?(?:the\s+)?"
            r"(?:anthropic|openai)\b",
            _I,
        ),
    ),
    (
        "override_zh",
        re.compile(
            r"(?:系統|系统)(?:提示|指令)|(?:忽略|無視|无视|唔好理|唔理|不要理會|不要理会)"
            r".{0,8}(?:規則|规则|指示|指令|限制)"
        ),
    ),
)


@dataclass(frozen=True)
class InjectionHit:
    """Which pre-check pattern matched, and in which field (never the text itself)."""

    pattern: str
    field: str


def _strings(value: Any, path: str) -> Iterator[tuple[str, str]]:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, Mapping):
        for k, v in value.items():
            yield path + "." + str(k), str(k)
            yield from _strings(v, f"{path}.{k}")
    elif isinstance(value, list | tuple | set | frozenset):
        for i, v in enumerate(value):
            yield from _strings(v, f"{path}[{i}]")


def injection_precheck(question: str, place_facts: Any = None) -> InjectionHit | None:
    """The first blatant injection attempt in the question or in any string inside
    `place_facts` (place names and tags are untrusted too), else None."""
    for field, text in [("question", question), *_strings(place_facts, "place_facts")]:
        norm = _normalise(text)
        for name, pattern in _INJECTION_PATTERNS:
            if pattern.search(norm):
                log.warning("prompt-injection pre-check: pattern %s in %s", name, field)
                return InjectionHit(pattern=name, field=field)
    return None


def injection_hit(question: str, place_facts: Any = None) -> PolicyHit | None:
    """`injection_precheck` as a policy hit on the `prompt_injection` rule."""
    hit = injection_precheck(question, place_facts)
    if hit is None:
        return None
    return PolicyHit(
        rule_id=INJECTION_RULE,
        reason="The request tries to change or reveal how the agent works.",
        source="precheck",
    )


# --- Area gates -----------------------------------------------------------------------------

#: Returns a short reason when `area` overlaps a military area, else None.
MilitaryCheck = Callable[[Any], str | None]


def _no_military_data(area: Any) -> str | None:
    """Default military check: no data yet, so it never matches.

    TODO(A3, rules.yaml military_targeting `area_overlaps_osm: landuse=military`): test the
    area against OSM landuse=military polygons from an offline extract or an `earth` context
    provider (no network from here). Until then the guard LLM is the only military check.
    """
    del area
    return None


_military_check: MilitaryCheck = _no_military_data


def set_military_check(check: MilitaryCheck | None) -> None:
    """Plug in a military-overlap check (None restores the default, which never matches)."""
    global _military_check
    _military_check = check or _no_military_data


def military_overlap(area: Any) -> PolicyHit | None:
    """A `military_targeting` hit when `area` overlaps a military area, else None.

    Fails closed: if the plugged-in check raises, the area is treated as overlapping.
    """
    if area is None:
        return None
    try:
        reason = _military_check(area)
    except Exception:  # a broken check must not let a military area through
        log.exception("military check failed; blocking the area")
        reason = "The military-area check failed for this area."
    if reason is None:
        return None
    return PolicyHit(rule_id=MILITARY_RULE, reason=reason, source="military")


def _check_values(kb: KnowledgeBase, check_type: str) -> list[tuple[str, float]]:
    return [
        (rule.id, float(c.value))
        for rule in kb.policy.rules
        for c in rule.checks
        if c.type == check_type and isinstance(c.value, int | float)
    ]


def size_gate(area_ha: float | None, kb: KnowledgeBase) -> PolicyHit | None:
    """A hit when the area breaks a size check in `rules.yaml` (`max_area_km2` on
    `area_too_large`, `min_area_ha` on `below_resolution`), else None."""
    if area_ha is None or not math.isfinite(area_ha) or area_ha <= 0:
        return None
    for rule_id, km2 in _check_values(kb, "max_area_km2"):
        if area_ha / 100.0 > km2:
            return PolicyHit(
                rule_id=rule_id,
                reason=f"The area ({area_ha / 100.0:.0f} km2) is over the {km2:g} km2 budget.",
                source="size",
            )
    for rule_id, min_ha in _check_values(kb, "min_area_ha"):
        if area_ha < min_ha:
            return PolicyHit(
                rule_id=rule_id,
                reason=f"The area ({area_ha:g} ha) is under the {min_ha:g} ha the pixels resolve.",
                source="size",
            )
    return None
