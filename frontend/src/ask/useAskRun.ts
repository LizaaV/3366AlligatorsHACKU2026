/**
 * Owns the Ask conversation: submit a question, follow the run as it streams, show the answer.
 *
 * The history here matters for reading the code. The prototype walked a hardcoded list of
 * reasoning steps on a timer and synthesised an answer locally. The first API pass replaced
 * that with `POST /api/ask` plus *prewritten* progress scripts played while the request was in
 * flight, because the proposed contract was request/response.
 *
 * The real contract streams (`docs/API.md` §3), so neither is needed: the steps in the UI are
 * now the steps the backend actually took, arriving as `step_started` / `step_finished`. There
 * is no choreography to pace, hold or fast-forward — events are rendered as they arrive.
 *
 * One code path serves both sources: in fixture mode `runsApi.stream` synthesises the same
 * event sequence locally (see `src/api/endpoints/runs.ts`), so this hook never branches on
 * whether a backend is present.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, DEFAULT_PIN_RADIUS_M, api, isEvent, toApiError, type StreamEvent } from '../api';
import type { AnswerBlock, Answer, RunStep } from '../model';
import { toAnswer } from '../model';
import type { components } from '../api/schema';

type S = components['schemas'];

export type AskStage = 'idle' | 'starting' | 'locating' | 'routing' | 'analysing' | 'done' | 'error';

/** `done` status values the contract can end a stream with. */
export type RunStatus = S['Done']['status'];

export interface AskTurn {
  id: string;
  text: string;
  placeId: string | null;
  skillId?: string;
  /** A pinned spot with no saved place behind it (set from a globe click). */
  point?: { lat: number; lon: number; name?: string } | null;
  /** `clarify` is waiting on the user; `running` has a stream open. */
  phase: 'clarify' | 'running' | 'done' | 'error';
  /** Ids the server assigned — `runId` for reload/reply/share, `threadId` for follow-ups. */
  runId: string | null;
  threadId: string | null;
  /** Real steps, keyed by the server's `index`. */
  steps: RunStep[];
  /** Visuals, in arrival order. At most one is `primary`. */
  blocks: AnswerBlock[];
  /** Set when the agent needs the user; the turn then waits for `reply`. */
  clarification: S['ClarificationNeeded'] | null;
  /** Answers the user gave to the clarification. */
  answers: Record<string, string>;
  /** Whether the agent would remember these answers against the place. */
  remember: boolean;
  /** A refusal or scope decision, when the guard reported one worth showing. */
  guard: S['GuardEvent'] | null;
  /** Whether the step list is expanded. */
  open: boolean;
  status: RunStatus | null;
  answer?: Answer;
  /** An in-stream `error` event, which is not the same as the request failing. */
  streamError?: S['ErrorEvent'];
  error?: ApiError;
  durationMs?: number;
}

export interface SubmitOptions {
  skillId?: string;
  /** `undefined` means "use the currently selected place". */
  placeId?: string | null;
  /** Ask about a pinned point instead of a saved place. */
  point?: { lat: number; lon: number; name?: string } | null;
  /** Continue an existing conversation rather than starting a new thread. */
  threadId?: string | null;
}

const newId = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

/** Merge a step event into the list, keyed on the server's index. */
function upsertStep(steps: RunStep[], ev: S['StepStarted'] | S['StepFinished']): RunStep[] {
  const done = ev.event === 'step_finished';
  const next: RunStep = {
    index: ev.index,
    tool: ev.tool,
    title: ev.title,
    desc: ev.desc,
    result: 'result' in ev ? (ev.result ?? null) : null,
    ms: 'ms' in ev ? (ev.ms ?? null) : null,
    error: 'error' in ev ? (ev.error ?? null) : null,
    done,
  };
  const at = steps.findIndex((s) => s.index === ev.index);
  if (at === -1) return [...steps, next];
  // step_finished supersedes step_started; never let a late start un-finish a step.
  return steps.map((s, i) => (i === at ? { ...s, ...next, done: s.done || done } : s));
}

export function useAskRun({ lang, selectedPlaceId }: { lang: string; selectedPlaceId: string | null }) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const inflight = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  /** Mirror of `turns`, so callbacks read the latest without side effects inside an updater
   *  (React double-invokes updaters in StrictMode, which would open two streams). */
  const turnsRef = useRef<AskTurn[]>([]);
  turnsRef.current = turns;

  useEffect(() => () => inflight.current?.abort(), []);

  const patchLast = useCallback((patch: Partial<AskTurn> | ((t: AskTurn) => Partial<AskTurn>)) => {
    setTurns((all) => {
      if (!all.length) return all;
      const last = all[all.length - 1];
      const p = typeof patch === 'function' ? patch(last) : patch;
      return [...all.slice(0, -1), { ...last, ...p }];
    });
  }, []);

  /** Translate one stream event into a patch on the live turn. */
  const onEvent = useCallback(
    (ev: StreamEvent) => {
      if (isEvent(ev, 'run_started')) {
        patchLast({ runId: ev.run_id, threadId: ev.thread_id });
        return;
      }
      if (isEvent(ev, 'guard')) {
        // Only worth surfacing when it is not a plain "yes, answerable".
        patchLast({ guard: ev.scope === 'answerable' ? null : ev });
        return;
      }
      if (isEvent(ev, 'step_started') || isEvent(ev, 'step_finished')) {
        patchLast((t) => ({ steps: upsertStep(t.steps, ev) }));
        return;
      }
      if (isEvent(ev, 'block_ready')) {
        patchLast((t) => ({ blocks: [...t.blocks, ev.block] }));
        return;
      }
      if (isEvent(ev, 'clarification_needed')) {
        patchLast({
          clarification: ev,
          remember: ev.remember,
          // Prefill only from the server's `value` (often the place's memory). A question with
          // no prefill stays unanswered: defaulting to the first option would put an answer the
          // user never gave into the request, and `remember` could then save it to the place.
          answers: Object.fromEntries(
            ev.questions.flatMap((q) => (q.value ? [[q.key, q.value] as const] : [])),
          ),
        });
        return;
      }
      if (isEvent(ev, 'clarification_answered')) {
        patchLast({ clarification: null, answers: ev.answers, remember: ev.remember });
        return;
      }
      if (isEvent(ev, 'answer')) {
        patchLast({ answer: toAnswer(ev.answer) });
        return;
      }
      if (isEvent(ev, 'error')) {
        patchLast({ streamError: ev });
        return;
      }
      if (isEvent(ev, 'done')) {
        patchLast({
          status: ev.status,
          // `waiting_user` keeps the clarification card open rather than ending the turn.
          phase: ev.status === 'waiting_user' ? 'clarify' : ev.status === 'failed' ? 'error' : 'done',
          open: ev.status === 'waiting_user',
          durationMs: Date.now() - startedAt.current,
        });
      }
    },
    [patchLast],
  );

  /** Open a stream. `kind` decides whether this starts a run or continues one. */
  const open = useCallback(
    async (turn: AskTurn, kind: 'start' | 'reply') => {
      inflight.current?.abort();
      const ac = new AbortController();
      inflight.current = ac;
      startedAt.current = Date.now();
      patchLast({ phase: 'running', error: undefined, streamError: undefined });

      try {
        if (kind === 'reply') {
          if (!turn.runId) throw new ApiError('Cannot reply before the run has started', 'http', 409);
          await api.runs.reply(turn.runId, { answers: turn.answers, remember: turn.remember }, onEvent, ac.signal);
        } else {
          await api.runs.stream(
            {
              question: turn.text,
              lang,
              place_id: turn.placeId,
              area: turn.point
                ? { point: { lat: turn.point.lat, lon: turn.point.lon, radius_m: DEFAULT_PIN_RADIUS_M }, name: turn.point.name ?? null }
                : null,
              thread_id: turn.threadId,
              skill_id: turn.skillId ?? null,
            },
            onEvent,
            ac.signal,
          );
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        const e = toApiError(err);
        if (e.kind === 'aborted') return;
        patchLast({ phase: 'error', error: e });
      }
    },
    [lang, onEvent, patchLast],
  );

  const submit = useCallback(
    (text: string, opts: SubmitOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const placeId = opts.placeId !== undefined ? opts.placeId : selectedPlaceId;
      // Follow-ups reuse the previous turn's thread, so the agent keeps the conversation.
      const prev = turnsRef.current[turnsRef.current.length - 1];
      const threadId = opts.threadId !== undefined ? opts.threadId : (prev?.threadId ?? null);

      const turn: AskTurn = {
        id: newId(),
        text: trimmed,
        placeId: placeId ?? null,
        skillId: opts.skillId,
        point: placeId ? null : (opts.point ?? null),
        phase: 'running',
        runId: null,
        threadId,
        steps: [],
        blocks: [],
        clarification: null,
        answers: {},
        remember: false,
        guard: null,
        open: true,
        status: null,
      };

      setTurns((all) => [...all.map((t) => ({ ...t, open: false })), turn]);
      void open(turn, 'start');
    },
    [open, selectedPlaceId],
  );

  /** The user filled in the clarification card and pressed Continue. */
  const continueAfterClarify = useCallback(() => {
    const last = turnsRef.current[turnsRef.current.length - 1];
    if (last?.clarification) void open(last, 'reply');
  }, [open]);

  const setAnswerValue = useCallback(
    (turnId: string, key: string, value: string) =>
      setTurns((all) => all.map((t) => (t.id === turnId ? { ...t, answers: { ...t.answers, [key]: value } } : t))),
    [],
  );

  const setRemember = useCallback(
    (turnId: string, remember: boolean) =>
      setTurns((all) => all.map((t) => (t.id === turnId ? { ...t, remember } : t))),
    [],
  );

  const toggleOpen = useCallback(
    (turnId: string) => setTurns((all) => all.map((t) => (t.id === turnId ? { ...t, open: !t.open } : t))),
    [],
  );

  const cancel = useCallback(() => {
    inflight.current?.abort();
    setTurns((all) => all.slice(0, -1));
  }, []);

  const retry = useCallback(() => {
    const last = turnsRef.current[turnsRef.current.length - 1];
    if (!last) return;
    // A failed run is restarted, not replied to: the server's run is already closed.
    void open({ ...last, steps: [], blocks: [], runId: null, status: null }, 'start');
    patchLast({ steps: [], blocks: [], runId: null, status: null });
  }, [open, patchLast]);

  const reset = useCallback(() => {
    inflight.current?.abort();
    setTurns([]);
  }, []);

  /** Replace the conversation with already-finished turns (a reloaded thread, or a hand-off from the mini chat). */
  const hydrate = useCallback((next: AskTurn[]) => {
    inflight.current?.abort();
    setTurns(next);
  }, []);

  const last = turns[turns.length - 1];

  /**
   * Coarse stage for the map choreography. Derived from how many steps have finished, which
   * is now real progress rather than a timer — but still deliberately coarse, because the
   * number of steps varies per run and the map must not depend on a specific step index.
   */
  const stage: AskStage = (() => {
    if (!last) return 'idle';
    if (last.phase === 'error') return 'error';
    if (last.phase === 'done') return 'done';
    if (last.phase === 'clarify') return 'idle';
    if (!last.steps.length) return 'starting';
    const finished = last.steps.filter((s) => s.done).length;
    const f = finished / Math.max(1, last.steps.length);
    if (f < 0.18) return 'starting';
    if (f < 0.38) return 'locating';
    if (f < 0.62) return 'routing';
    return 'analysing';
  })();

  return {
    turns,
    last,
    stage,
    submit,
    continueAfterClarify,
    setAnswerValue,
    setRemember,
    toggleOpen,
    cancel,
    retry,
    reset,
    hydrate,
    isBusy: last?.phase === 'running',
  };
}
