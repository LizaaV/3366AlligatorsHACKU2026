/**
 * Owns the Ask conversation: submit a question, play the progress choreography, show the
 * answer the API returns.
 *
 * This replaces the prototype's `advance()` step machine, which walked a hardcoded list of
 * reasoning steps on a timer and then synthesised an answer locally. Now:
 *
 *   1. `POST /api/ask` goes out (via `api.ask`)
 *   2. a prewritten script plays while it is in flight (`useProgressScript`)
 *   3. the answer comes back from the API and is rendered as-is
 *
 * The hook exposes a coarse `stage` rather than a raw step index, so the map choreography in
 * AskPage stays correct whichever random script is playing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, toApiError } from '../api';
import type { AnswerTimelineDto } from '../api/types';
import type { Answer, ClarifyingQuestion } from '../model';
import { GENERAL_SCRIPT_ID, type ProgressScript } from './progressScripts';
import { useProgressScript } from './useProgressScript';

export type AskStage = 'idle' | 'starting' | 'locating' | 'routing' | 'analysing' | 'done' | 'error';

export interface AskTurn {
  id: string;
  text: string;
  placeId: string | null;
  skillId?: string;
  /** `clarify` waits for the user; `running` has a request in flight. */
  phase: 'clarify' | 'running' | 'done' | 'error';
  /** Answers to the clarifying questions, sent as `context` on the request. */
  context: Record<string, string>;
  /** Whether the step list is expanded. */
  open: boolean;
  /** Set once the run completes, so a finished turn keeps showing its own script. */
  script: ProgressScript | null;
  answer?: Answer;
  timeline?: AnswerTimelineDto | null;
  error?: ApiError;
  durationMs?: number;
}

export interface SubmitOptions {
  skillId?: string;
  /** `undefined` means "use the currently selected place". */
  placeId?: string | null;
  /** Skip the clarifying questions even for a free-text place question. */
  skipClarify?: boolean;
}

const newId = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

export function useAskRun({
  lang,
  selectedPlaceId,
  clarifyingQuestions,
}: {
  lang: string;
  selectedPlaceId: string | null;
  clarifyingQuestions: ClarifyingQuestion[];
}) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const progress = useProgressScript();
  // `progress` is a new object each render; depend on its stable callbacks, not the object.
  const { start: startScript, finish: finishScript, cancel: cancelScript } = progress;
  const inflight = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  /** Mirror of `turns`, so callbacks can read the latest turn without side effects inside a
   *  state updater (React double-invokes updaters in StrictMode, which would fire two requests). */
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

  /** Fire the request. Separated so the clarify step and a retry can both reach it. */
  const run = useCallback(
    async (turn: AskTurn) => {
      inflight.current?.abort();
      const ac = new AbortController();
      inflight.current = ac;
      startedAt.current = Date.now();

      const script = startScript(turn.placeId ? undefined : GENERAL_SCRIPT_ID);
      patchLast({ phase: 'running', script, error: undefined });

      try {
        const result = await api.ask.ask(
          {
            question: turn.text,
            placeId: turn.placeId,
            skillId: turn.skillId,
            context: Object.keys(turn.context).length ? turn.context : undefined,
            lang,
          },
          ac.signal,
        );
        if (ac.signal.aborted) return;
        patchLast({ answer: result.answer, timeline: result.timeline, durationMs: Date.now() - startedAt.current });
        // Let the choreography catch up; `phase` flips to done when the player settles.
        finishScript();
      } catch (err) {
        if (ac.signal.aborted) return;
        const e = toApiError(err);
        if (e.kind === 'aborted') return;
        cancelScript();
        patchLast({ phase: 'error', error: e });
      }
    },
    [lang, patchLast, startScript, finishScript, cancelScript],
  );

  /** The player settling is what marks a turn done — so the answer never appears mid-script. */
  useEffect(() => {
    if (progress.phase !== 'done') return;
    setTurns((all) => {
      if (!all.length) return all;
      const last = all[all.length - 1];
      if (last.phase !== 'running' || !last.answer) return all;
      return [...all.slice(0, -1), { ...last, phase: 'done', open: false }];
    });
  }, [progress.phase]);

  const submit = useCallback(
    (text: string, opts: SubmitOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const placeId = opts.placeId !== undefined ? opts.placeId : selectedPlaceId;

      // A free-text question about a place gets the clarifying questions first; running a named
      // skill does not, because the skill already encodes its inputs.
      // TODO(api): the backend should decide this — `POST /ask` could return
      // `needs: [questionKey]` instead of the frontend guessing.
      const needsClarify = !!placeId && !opts.skillId && !opts.skipClarify && clarifyingQuestions.length > 0;

      const turn: AskTurn = {
        id: newId(),
        text: trimmed,
        placeId: placeId ?? null,
        skillId: opts.skillId,
        phase: needsClarify ? 'clarify' : 'running',
        context: Object.fromEntries(clarifyingQuestions.map((q) => [q.key, q.options[0]])),
        open: true,
        script: null,
      };

      setTurns((all) => [...all.map((t) => ({ ...t, open: false })), turn]);
      if (!needsClarify) void run(turn);
    },
    [clarifyingQuestions, run, selectedPlaceId],
  );

  /** User answered the clarifying questions and pressed Continue. */
  const continueAfterClarify = useCallback(() => {
    const last = turnsRef.current[turnsRef.current.length - 1];
    if (last?.phase === 'clarify') void run(last);
  }, [run]);

  const setContext = useCallback(
    (turnId: string, key: string, value: string) =>
      setTurns((all) => all.map((t) => (t.id === turnId ? { ...t, context: { ...t.context, [key]: value } } : t))),
    [],
  );

  const toggleOpen = useCallback(
    (turnId: string) => setTurns((all) => all.map((t) => (t.id === turnId ? { ...t, open: !t.open } : t))),
    [],
  );

  const cancel = useCallback(() => {
    inflight.current?.abort();
    cancelScript();
    setTurns((all) => all.slice(0, -1));
  }, [cancelScript]);

  const retry = useCallback(() => {
    const last = turnsRef.current[turnsRef.current.length - 1];
    if (last) void run(last);
  }, [run]);

  const reset = useCallback(() => {
    inflight.current?.abort();
    cancelScript();
    setTurns([]);
  }, [cancelScript]);

  const last = turns[turns.length - 1];

  /** Coarse stage, derived from how far through the script the player is. */
  const stage: AskStage = (() => {
    if (!last) return 'idle';
    if (last.phase === 'error') return 'error';
    if (last.phase === 'done') return 'done';
    if (last.phase === 'clarify') return 'idle';
    const steps = progress.script?.steps.length ?? 0;
    if (!steps) return 'starting';
    const f = progress.index / Math.max(1, steps - 1);
    if (f < 0.18) return 'starting';
    if (f < 0.38) return 'locating';
    if (f < 0.62) return 'routing';
    return 'analysing';
  })();

  return {
    turns,
    last,
    progress,
    stage,
    submit,
    continueAfterClarify,
    setContext,
    toggleOpen,
    cancel,
    retry,
    reset,
    isBusy: last?.phase === 'running',
  };
}
