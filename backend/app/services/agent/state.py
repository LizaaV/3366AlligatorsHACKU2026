"""The agent loop's resumable state (BUILD-PLAN A3), persisted at `RunRecord.params["agent"]`.

Everything the harness needs to continue a run after a clarification reply lives here: the
append-only transcript (with each provider's raw payload), counters for the loop limits,
hypotheses and their expectation table, the scripts that ran, merged findings, produced
block refs and the tool results waiting to go back with the user's answers.

`memory_values` is private: the leak check uses it so no remembered value ever appears in
agent text. Full blocks live on the record (`RunRecord.blocks`); only refs are kept here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.schemas.runs import RunRecord
from app.schemas.stream import ExpectationRow
from app.services.agent.llm.base import Message, ToolResult, Usage
from app.services.sandbox import ScriptError

__all__ = [
    "AGENT_KEY",
    "CHANGE_FIELDS",
    "AgentState",
    "BlockRef",
    "GuardVerdict",
    "PlaceInfo",
    "ScriptRun",
]

#: Key of the agent state in `RunRecord.params`.
AGENT_KEY = "agent"
#: Reading fields that describe one change and are merged together (`merge_findings`).
CHANGE_FIELDS: tuple[str, ...] = ("before", "after", "delta")


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _observed(findings: dict[str, Any]) -> dict[str, Any]:
    obs = findings.get("observed")
    return obs if isinstance(obs, dict) else {}


class ScriptRun(BaseModel):
    """One `run_code` / `run_skill` call and what came of it."""

    index: int = Field(description="1-based order among the run's scripts.")
    kind: Literal["code", "skill"]
    skill_id: str | None = None
    script: str | None = Field(None, description="Source for `code`; None for skills.")
    params: dict[str, Any] = Field(default_factory=dict)
    ok: bool
    block_ids: list[str] = Field(default_factory=list)
    error: ScriptError | None = None


class BlockRef(BaseModel):
    """A block produced by the run (the full block is on the record)."""

    id: str
    type: str
    title: str


class PlaceInfo(BaseModel):
    """What the harness knows about the place, shown to the model."""

    name: str | None = None
    area_ha: float | None = None
    facts: str | None = Field(None, description="Compact summary of `earth.describe` facts.")


class GuardVerdict(BaseModel):
    """The guard's verdict (values of `GuardEvent`)."""

    scope: str
    rule_id: str | None = None
    reason: str | None = None


class AgentState(BaseModel):
    """Resumable agent loop state; `load` from a record, store `dump()` under `AGENT_KEY`."""

    provider: str
    model: str
    transcript: list[Message] = Field(default_factory=list)
    turns: int = 0
    code_runs: int = 0
    asks: int = 0
    finish_attempts: int = 0
    hypotheses: list[str] = Field(default_factory=list, description="Registered card ids.")
    post_hoc: list[str] = Field(
        default_factory=list, description="Card ids registered after the first data read."
    )
    expectation_table: list[ExpectationRow] = Field(default_factory=list)
    cards_read: list[str] = Field(default_factory=list)
    scripts: list[ScriptRun] = Field(default_factory=list)
    findings: dict[str, Any] = Field(
        default_factory=dict, description='Merged findings; `findings["observed"]` is scored.'
    )
    context_observed: dict[str, Any] = Field(
        default_factory=dict,
        description="Context readings from `earth.describe` (e.g. slope_deg), scored only for "
        "measures no script observed.",
    )
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    blocks: list[BlockRef] = Field(default_factory=list)
    pending_results: list[ToolResult] = Field(
        default_factory=list, description="Results held back while waiting for the user."
    )
    pending_ask_call_id: str | None = None
    usage: Usage = Field(default_factory=Usage)
    place: PlaceInfo | None = None
    memory_values: list[str] = Field(
        default_factory=list, description="Private: remembered values, for the leak check."
    )
    guard: GuardVerdict | None = None
    step_index: int = Field(0, description="Last step index streamed (monotonic per run).")
    carried_from: str | None = Field(
        None, description="Follow-up (A4): the earlier run in the thread whose work was carried."
    )
    carried_results: list[str] = Field(
        default_factory=list,
        description="Follow-up (A4): the earlier run's data-tool results (number sources).",
    )
    started_at: datetime = Field(default_factory=_utcnow, description="UTC.")

    @classmethod
    def load(cls, record: RunRecord) -> AgentState | None:
        """The state stored on `record`, or None if the run has none (e.g. a preset run)."""
        data = record.params.get(AGENT_KEY)
        return None if data is None else cls.model_validate(data)

    def dump(self) -> dict[str, Any]:
        """JSON-ready dict for `RunRecord.params[AGENT_KEY]`."""
        return self.model_dump(mode="json")

    @property
    def data_read(self) -> bool:
        """True once any script or skill has run (data was seen)."""
        return bool(self.scripts)

    def merge_findings(self, findings: dict[str, Any]) -> list[str]:
        """Merge one script's findings and return what changed in earlier readings.

        Per measure in `observed`, field by field: a later reading's non-null fields win and
        its null fields keep the earlier values (a partial re-look does not erase a skill's
        `local` / `inside_band` / `date`). The change fields `before`, `after` and `delta`
        move together: when the new reading sets any of them, all three come from it, so a
        delta never mixes two definitions of before and after. Other keys are replaced at
        the top level. Returns e.g. ["water.before 0.106 -> 0.088"] for every changed value.
        """
        merged = dict(_observed(self.findings))
        changed: list[str] = []
        for measure, new in _observed(findings).items():
            old = merged.get(measure)
            if not isinstance(new, dict) or not isinstance(old, dict):
                if old is not None and old != new:
                    changed.append(f"{measure} replaced")
                merged[measure] = new
                continue
            out = dict(old)
            if any(new.get(k) is not None for k in CHANGE_FIELDS):
                out.update({k: new.get(k) for k in CHANGE_FIELDS})
            for key, value in new.items():
                if value is not None:
                    out[key] = value
            for key, value in out.items():
                if key in old and old[key] is not None and old[key] != value:
                    changed.append(f"{measure}.{key} {old[key]} -> {value}")
            merged[measure] = out
        self.findings = {**self.findings, **findings, "observed": merged}
        return changed
