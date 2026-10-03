"""Server-sent events for a run, one model per event.

Two endpoints stream these, both for the same `run_id`:

- `POST /api/runs` starts the run and streams it.
- `POST /api/runs/{id}/reply` answers a `clarification_needed` card and streams the rest.

Every stream ends with exactly one `done`. When the run needs the user, the stream sends
`clarification_needed` then `done{status: "waiting_user"}` and closes; the run stays
`waiting_user` in the store until the reply. The reply stream starts with
`clarification_answered` (also stored in the event log, so replay shows the answers),
then continues with steps, blocks and `answer`, and ends with its own `done`.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

import earth
from app.schemas.answer import Answer
from earth.blocks import Block

RunStatus = Literal["running", "waiting_user", "done", "failed", "refused"]


class RunStarted(BaseModel):
    """The run has been accepted and started."""

    event: Literal["run_started"] = "run_started"
    run_id: str
    thread_id: str


class GuardEvent(BaseModel):
    """The guard's verdict on whether the question can be answered."""

    event: Literal["guard"] = "guard"
    scope: Literal["answerable", "partial", "out_of_scope", "not_allowed", "emergency", "off_topic"]
    rule_id: str | None = Field(None, description="Policy rule that fired, if any.")
    reason: str | None = None


class ExpectationRow(BaseModel):
    """What a hypothesis predicts per measure, and what was observed."""

    hypothesis: str = Field(description="Knowledge card id.")
    expected: dict[str, str] = Field(description="Measure → expected direction/value.")
    observed: dict[str, str] = Field(default_factory=dict)
    verdict: Literal["supported", "contradicted", "unclear", "untested"] = "untested"


class HypothesesRegistered(BaseModel):
    """Hypotheses registered before reading data (or after, when post_hoc)."""

    event: Literal["hypotheses_registered"] = "hypotheses_registered"
    hypotheses: list[str] = Field(description="Knowledge card ids.")
    expectation_table: list[ExpectationRow] = Field(default_factory=list)
    post_hoc: bool = Field(False, description="True if registered after the first data read.")


class ValueSource(BaseModel):
    """Where a prefilled clarification value came from."""

    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    from_: Literal["memory", "inferred"] = Field(alias="from")
    saved: date | None = Field(None, description="When the remembered value was saved.")


class ClarificationQuestion(BaseModel):
    """One question for the user, optionally prefilled."""

    key: str
    label: str
    options: list[str] = Field(default_factory=list)
    value: str | None = Field(None, description="Prefilled answer, if known.")
    source: ValueSource | None = None


class ClarificationNeeded(BaseModel):
    """The run is waiting for the user to answer questions."""

    event: Literal["clarification_needed"] = "clarification_needed"
    questions: list[ClarificationQuestion]
    remember: bool = Field(True, description="Default for 'remember my answers'.")


class ClarificationAnswered(BaseModel):
    """The user answered the clarification card (first event of the reply stream)."""

    event: Literal["clarification_answered"] = "clarification_answered"
    answers: dict[str, str] = Field(description="Question key → answer, as accepted.")
    remember: bool = Field(description="Whether the answers were saved to the place profile.")


class StepStarted(BaseModel):
    """A visible reasoning step started."""

    event: Literal["step_started"] = "step_started"
    index: int
    title: str
    desc: str
    tool: str


class StepFinished(BaseModel):
    """A visible reasoning step finished."""

    event: Literal["step_finished"] = "step_finished"
    index: int
    title: str
    desc: str
    tool: str
    result: str | None = None
    ms: int | None = None
    provenance: earth.Provenance | None = None
    error: str | None = None


class BlockReady(BaseModel):
    """A visual block is ready to render."""

    event: Literal["block_ready"] = "block_ready"
    block: Block


class AnswerEvent(BaseModel):
    """The final answer."""

    event: Literal["answer"] = "answer"
    answer: Answer


class ErrorEvent(BaseModel):
    """Something went wrong; `recoverable` says whether the run continues."""

    event: Literal["error"] = "error"
    message: str
    recoverable: bool
    kind: str | None = None


class Done(BaseModel):
    """The stream ended (always its last event).

    `waiting_user`: the run is paused on a `clarification_needed` card; continue it with
    `POST /api/runs/{run_id}/reply`, which streams the rest of the run.
    """

    event: Literal["done"] = "done"
    run_id: str
    status: RunStatus
    tokens: int = 0
    cost_usd: float = 0.0
    ms: int


StreamEvent = Annotated[
    RunStarted
    | GuardEvent
    | HypothesesRegistered
    | ClarificationNeeded
    | ClarificationAnswered
    | StepStarted
    | StepFinished
    | BlockReady
    | AnswerEvent
    | ErrorEvent
    | Done,
    Field(discriminator="event"),
]


def to_sse(ev: StreamEvent) -> dict[str, str]:
    """Shape an event for sse-starlette: `{"event": name, "data": json}`."""
    return {"event": ev.event, "data": ev.model_dump_json(by_alias=True)}
