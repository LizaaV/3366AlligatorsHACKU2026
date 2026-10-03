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
import { turnFromRecord } from '../components/chat/threadTurns';
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

/** Translate one stream event into the next state of the live turn. Pure, so a stream can keep
 *  feeding a turn after the component that opened it is gone (see `detach`). */
function applyEvent(t: AskTurn, ev: StreamEvent, startedAt: number): AskTurn {
  if (isEvent(ev, 'run_started')) return { ...t, runId: ev.run_id, threadId: ev.thread_id };
  // Only worth surfacing when it is not a plain "yes, answerable".
  if (isEvent(ev, 'guard')) return { ...t, guard: ev.scope === 'answerable' ? null : ev };
  if (isEvent(ev, 'step_started') || isEvent(ev, 'step_finished')) return { ...t, steps: upsertStep(t.steps, ev) };
  if (isEvent(ev, 'block_ready')) return { ...t, blocks: [...t.blocks, ev.block] };
  if (isEvent(ev, 'clarification_needed')) {
    return {
      ...t,
      clarification: ev,
      remember: ev.remember,
      // Prefill only from the server's `value` (often the place's memory). A question with
      // no prefill stays unanswered: defaulting to the first option would put an answer the
      // user never gave into the request, and `remember` could then save it to the place.
      answers: Object.fromEntries(ev.questions.flatMap((q) => (q.value ? [[q.key, q.value] as const] : []))),
    };
  }
  if (isEvent(ev, 'clarification_answered')) return { ...t, clarification: null, answers: ev.answers, remember: ev.remember };
  if (isEvent(ev, 'answer')) return { ...t, answer: toAnswer(ev.answer) };
  if (isEvent(ev, 'error')) return { ...t, streamError: ev };
  if (isEvent(ev, 'done')) {
    return {
      ...t,
      status: ev.status,
      // `waiting_user` keeps the clarification card open rather than ending the turn.
      phase: ev.status === 'waiting_user' ? 'clarify' : ev.status === 'failed' ? 'error' : 'done',
      open: ev.status === 'waiting_user',
      durationMs: Date.now() - startedAt,
    };
  }
  return t;
}

/**
 * A stream that outlives the component that opened it. "Open in full chat" unmounts the
 * bubble, and the server closes a run whose client has gone away, so the stream is handed to
 * the Ask page's `useAskRun` instead of being aborted. Keyed by turn id; `hydrate` adopts it.
 */
interface DetachedRun {
  turn: AskTurn;
  ac: AbortController;
  startedAt: number;
  /** Set once the Ask page has adopted the run; events are forwarded to it from then on. */
  sink: ((f: (t: AskTurn) => AskTurn) => void) | null;
}
let detached: DetachedRun | null = null;

/** How often, and for how long, a reloaded `running` run is polled before giving up. */
const POLL_MS = 2000;
const POLL_MAX_MS = 4 * 60_000;
const POLL_MAX_ERRORS = 5;

export function useAskRun({ lang, selectedPlaceId }: { lang: string; selectedPlaceId: string | null }) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const inflight = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  /** Mirror of `turns`, so callbacks read the latest without side effects inside an updater
   *  (React double-invokes updaters in StrictMode, which would open two streams). */
  const turnsRef = useRef<AskTurn[]>([]);
  turnsRef.current = turns;

  /** The patch function of the stream the hook opened, so `detach` can redirect it. */
  const route = useRef<{ apply: (f: (t: AskTurn) => AskTurn) => void } | null>(null);
  const pollers = useRef(new Map<string, AbortController>());
  const stopPolling = useCallback(() => {
    pollers.current.forEach((ac) => ac.abort());
    pollers.current.clear();
  }, []);

  useEffect(
    () => () => {
      // `detach` clears `inflight`, so a stream handed to the Ask page is not cut here.
      inflight.current?.abort();
      stopPolling();
    },
    [stopPolling],
  );

  const patchLast = useCallback((patch: Partial<AskTurn> | ((t: AskTurn) => Partial<AskTurn>)) => {
    setTurns((all) => {
      if (!all.length) return all;
      const last = all[all.length - 1];
      const p = typeof patch === 'function' ? patch(last) : patch;
      return [...all.slice(0, -1), { ...last, ...p }];
    });
  }, []);

  /** Open a stream. `kind` decides whether this starts a run or continues one. */
  const open = useCallback(
    async (turn: AskTurn, kind: 'start' | 'reply') => {
      inflight.current?.abort();
      const ac = new AbortController();
      inflight.current = ac;
      const began = Date.now();
      startedAt.current = began;
      // Every update from this stream goes through `stream.apply`, which `detach` can redirect.
      const stream = { apply: (f: (t: AskTurn) => AskTurn) => patchLast(f) };
      route.current = stream;
      const onEvent = (ev: StreamEvent) => stream.apply((t) => applyEvent(t, ev, began));
      stream.apply((t) => ({ ...t, phase: 'running', error: undefined, streamError: undefined }));

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
        stream.apply((t) => ({ ...t, phase: 'error', error: e }));
      }
    },
    [lang, patchLast],
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
    stopPolling();
    setTurns([]);
  }, [stopPolling]);

  /**
   * Follow a run this tab is not streaming (a reloaded thread, or a run still going on the
   * server): poll `GET /api/runs/{id}` until it is final. The API has no way to re-join a
   * stream, so the steps and blocks arrive in whole as the record fills up.
   */
  const pollRun = useCallback((turnId: string, runId: string) => {
    pollers.current.get(turnId)?.abort();
    const ac = new AbortController();
    pollers.current.set(turnId, ac);
    const began = Date.now();
    const patch = (f: (t: AskTurn) => AskTurn) => setTurns((all) => all.map((t) => (t.id === turnId ? f(t) : t)));
    void (async () => {
      let errors = 0;
      while (!ac.signal.aborted) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (ac.signal.aborted) return;
        try {
          const rec = await api.runs.get(runId, ac.signal);
          errors = 0;
          if (rec.status === 'running') {
            if (Date.now() - began > POLL_MAX_MS) break;
            const n = turnFromRecord(rec);
            patch((t) => ({ ...t, steps: n.steps, blocks: n.blocks }));
            continue;
          }
          const n = turnFromRecord(rec);
          patch((t) => ({
            ...t,
            steps: n.steps, blocks: n.blocks, answer: n.answer, status: n.status, phase: n.phase,
            clarification: n.clarification, answers: n.answers, remember: n.remember,
            guard: n.guard, streamError: n.streamError, open: n.open, durationMs: n.durationMs,
          }));
          pollers.current.delete(turnId);
          return;
        } catch (err) {
          if (ac.signal.aborted) return;
          if (++errors >= POLL_MAX_ERRORS) {
            const e = toApiError(err);
            patch((t) => ({ ...t, phase: 'error', error: e }));
            pollers.current.delete(turnId);
            return;
          }
        }
      }
      if (ac.signal.aborted) return;
      pollers.current.delete(turnId);
      patch((t) => ({
        ...t,
        phase: 'error',
        error: new ApiError('This run stopped making progress. Ask again to retry.', 'http', 504),
      }));
    })();
  }, []);

  /**
   * Replace the conversation with existing turns (a reloaded thread, or a hand-off from the
   * mini chat). A stream handed off by `detach` is re-attached to its turn; any other turn
   * that is still `running` on the server is polled until it is final.
   */
  const hydrate = useCallback(
    (next: AskTurn[]) => {
      inflight.current?.abort();
      stopPolling();
      let list = next;
      const live = detached;
      const at = live ? next.findIndex((t) => t.id === live.turn.id) : -1;
      if (live && at !== -1) {
        detached = null;
        list = next.map((t, i) => (i === at ? live.turn : t));
        inflight.current = live.ac;
        startedAt.current = live.startedAt;
        // Events keep landing on the same turn, now through this hook.
        live.sink = (f) => setTurns((all) => all.map((t) => (t.id === live.turn.id ? f(t) : t)));
        route.current = { apply: live.sink };
      }
      setTurns(list);
      for (const t of list) {
        if (t.phase === 'running' && t.runId && !(live && t.id === live.turn.id)) pollRun(t.id, t.runId);
      }
    },
    [pollRun, stopPolling],
  );

  /**
   * Let the open stream keep running while this hook goes away ("Open in full chat" from the
   * bubble). The server ends a run whose client disconnects, so aborting would leave the turn
   * unfinished for good. The next `hydrate` containing this turn takes the stream over.
   */
  const detach = useCallback((): void => {
    const turn = turnsRef.current[turnsRef.current.length - 1];
    const stream = route.current;
    if (!turn || turn.phase !== 'running' || !inflight.current || !stream) return;
    const live: DetachedRun = { turn, ac: inflight.current, startedAt: startedAt.current, sink: null };
    detached = live;
    inflight.current = null;
    stream.apply = (f) => {
      live.turn = f(live.turn);
      live.sink?.(f);
    };
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
    detach,
    isBusy: last?.phase === 'running',
  };
}
