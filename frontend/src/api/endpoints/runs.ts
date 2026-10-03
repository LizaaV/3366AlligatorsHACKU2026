/**
 * Runs: ask a question about a place and watch the agent work.
 *
 * This replaces the old `POST /api/ask` proposal. The real contract streams, so the
 * step-by-step reveal is no longer loading theatre played in the frontend — the steps in the
 * UI are now the steps the backend actually took, arriving as `step_started` / `step_finished`
 * events. See `docs/API.md` §3.
 *
 *   POST /api/runs              -> SSE stream
 *   GET  /api/runs/{id}         -> RunRecord, for a reload or a share page
 *   POST /api/runs/{id}/reply   -> SSE stream, continues the same run after a clarification
 *
 * In fixture mode the same event sequence is synthesised locally, so components have exactly
 * one code path to handle and offline development still exercises the real contract shape.
 * The prewritten scripts in `src/ask/progressScripts.ts` supply the step text there: they were
 * always process-only descriptions, which is precisely what a step event carries.
 */

import { ApiError, request } from '../http';
import { FIXTURE_CLARIFY, FIXTURE_ERROR_RATE, usingFixtures } from '../config';
import { streamSse, type StreamEvent } from '../stream';
import type { components } from '../schema';
import { pickProgressScript } from '../../ask/progressScripts';
import { FIXTURE_RUN_ANSWER, FIXTURE_CLARIFICATION } from '../fixtures/run';

type S = components['schemas'];

export type RunRequest = S['RunRequest'];
export type ReplyRequest = S['ReplyRequest'];
export type RunRecord = S['RunRecord'];
export type BackendAnswer = S['Answer'];

export type RunEventHandler = (ev: StreamEvent) => void;

/** Pace of the synthesised fixture stream. Real runs arrive at whatever pace the server sends. */
const FIXTURE_STEP_MS = 420;

export const runsApi = {
  /** POST /api/runs — stream a new run. */
  stream: (body: RunRequest, onEvent: RunEventHandler, signal?: AbortSignal): Promise<void> =>
    usingFixtures()
      ? fixtureStream(body, onEvent, signal, { clarify: FIXTURE_CLARIFY })
      : streamSse('/runs', body, onEvent, signal),

  /** GET /api/runs/{run_id} — reload a finished or paused run. */
  get: (runId: string, signal?: AbortSignal): Promise<RunRecord> =>
    request<RunRecord>({
      method: 'GET',
      path: `/runs/${encodeURIComponent(runId)}`,
      signal,
      ...(usingFixtures() ? { fixture: () => fixtureRecord(runId) } : {}),
    }),

  /** POST /api/runs/{run_id}/reply — answer a clarification and stream the rest of the run. */
  reply: (runId: string, body: ReplyRequest, onEvent: RunEventHandler, signal?: AbortSignal): Promise<void> =>
    usingFixtures()
      ? fixtureReply(body, onEvent, signal)
      : streamSse(`/runs/${encodeURIComponent(runId)}/reply`, body, onEvent, signal),
};

/* ------------------------------------------------------------------ fixtures */

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

const fixtureId = (prefix: string) =>
  `${prefix}_${Math.floor(Math.random() * 0xffffffffffff).toString(16).padStart(12, '0')}`;

/**
 * Synthesise the documented event order from §3.4:
 *   run_started -> guard -> hypotheses_registered -> (step_started -> step_finished)xN
 *   -> block_ready xM -> answer -> done
 */
async function fixtureStream(
  body: RunRequest,
  onEvent: RunEventHandler,
  signal?: AbortSignal,
  opts: { clarify?: boolean } = {},
): Promise<void> {
  const runId = fixtureId('r');
  const threadId = body.thread_id ?? fixtureId('t');
  const script = pickProgressScript();
  const answer = FIXTURE_RUN_ANSWER;

  // A run can fail in two distinct ways, and the UI treats them differently, so the fixture
  // has to be able to produce both: before the stream opens it is an HTTP error, and after it
  // opens it is an `error` event (§8). Split the configured rate evenly between them.
  if (FIXTURE_ERROR_RATE > 0 && Math.random() < FIXTURE_ERROR_RATE) {
    if (Math.random() < 0.5) {
      throw new ApiError('Simulated fixture failure for POST /runs', 'http', 503);
    }
    onEvent({ event: 'run_started', run_id: runId, thread_id: threadId });
    await wait(FIXTURE_STEP_MS, signal);
    onEvent({
      event: 'error',
      message: 'No clear scenes in the requested window.',
      recoverable: false,
      kind: 'no_clear_scenes',
    });
    onEvent({ event: 'done', run_id: runId, status: 'failed', tokens: 0, cost_usd: 0, ms: 0 });
    return;
  }

  onEvent({ event: 'run_started', run_id: runId, thread_id: threadId });
  onEvent({ event: 'guard', scope: 'answerable', rule_id: null, reason: null });

  // Pause for the user, then end the stream with `waiting_user` exactly as §4 describes.
  if (opts.clarify) {
    await wait(FIXTURE_STEP_MS, signal);
    onEvent({ event: 'clarification_needed', questions: FIXTURE_CLARIFICATION, remember: true });
    onEvent({ event: 'done', run_id: runId, status: 'waiting_user', tokens: 0, cost_usd: 0, ms: 0 });
    return;
  }
  onEvent({
    event: 'hypotheses_registered',
    hypotheses: answer.method?.cards?.map((c) => c.id) ?? [],
    expectation_table: [],
    post_hoc: false,
  });

  for (const [i, step] of script.steps.entries()) {
    await wait(FIXTURE_STEP_MS, signal);
    const common = { index: i + 1, title: step.title, desc: step.desc, tool: step.tool };
    onEvent({ event: 'step_started', ...common });
    await wait(FIXTURE_STEP_MS, signal);
    onEvent({
      event: 'step_finished',
      ...common,
      result: step.result ?? null,
      ms: FIXTURE_STEP_MS,
      provenance: null,
      error: null,
    });
  }

  for (const block of answer.blocks ?? []) {
    await wait(120, signal);
    onEvent({ event: 'block_ready', block });
  }

  await wait(160, signal);
  onEvent({ event: 'answer', answer });
  onEvent({ event: 'done', run_id: runId, status: 'done', tokens: 0, cost_usd: 0, ms: 0 });
}

/** A reply stream opens with `clarification_answered`, then continues like a normal run. */
async function fixtureReply(body: ReplyRequest, onEvent: RunEventHandler, signal?: AbortSignal): Promise<void> {
  onEvent({ event: 'clarification_answered', answers: body.answers, remember: body.remember });
  await fixtureStream({ question: '', lang: 'en' }, (ev) => {
    // The run already started; don't claim it started again.
    if (ev.event !== 'run_started') onEvent(ev);
  }, signal);
}

function fixtureRecord(runId: string): RunRecord {
  return {
    run_id: runId,
    thread_id: fixtureId('t'),
    user_id: 'demo',
    question: '',
    status: 'done',
    answer: FIXTURE_RUN_ANSWER,
    created_at: new Date().toISOString(),
  } as RunRecord;
}
