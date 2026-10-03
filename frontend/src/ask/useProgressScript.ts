/**
 * Plays a prewritten progress script while a request is in flight.
 *
 * This is loading choreography, not a log of backend work — see `progressScripts.ts`.
 *
 * Behaviour that matters:
 *   - steps advance on a timer while the request is pending
 *   - if the request is SLOWER than the script, it holds on the last step rather than
 *     finishing and leaving the user staring at a completed list with no answer
 *   - if the request is FASTER, it fast-forwards: remaining steps complete quickly instead of
 *     making the user wait out the theatre
 *   - cancelling stops the timer and clears state
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { pickProgressScript, scriptById, type ProgressScript } from './progressScripts';

/** Normal pace, per step. */
const STEP_MS = 950;
/** Pace once the answer has arrived and we are catching up. */
const FAST_MS = 160;

export type ProgressPhase = 'idle' | 'running' | 'finishing' | 'done';

export interface ProgressState {
  script: ProgressScript | null;
  /** Index of the step currently in progress. Steps before it are complete. */
  index: number;
  phase: ProgressPhase;
  /** The script reached its last step and is waiting on the request. */
  holding: boolean;
}

export interface ProgressController extends ProgressState {
  /** Begin a script. Pass an id to force a specific one; unknown ids fall back to random. */
  start: (scriptId?: string) => ProgressScript;
  /** The request resolved — catch up through any remaining steps, then settle. */
  finish: () => void;
  /** Abandon the run. */
  cancel: () => void;
}

export function useProgressScript(): ProgressController {
  const [state, setState] = useState<ProgressState>({ script: null, index: 0, phase: 'idle', holding: false });
  const timer = useRef<number | undefined>(undefined);
  const lastId = useRef<string | undefined>(undefined);
  /** True once the request has resolved, so the player knows it may settle. */
  const resolved = useRef(false);

  const clear = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  useEffect(() => clear, [clear]);

  const tick = useCallback(() => {
    clear();
    timer.current = window.setTimeout(
      () => {
        setState((s) => {
          if (!s.script || s.phase === 'idle' || s.phase === 'done') return s;
          const last = s.script.steps.length - 1;

          if (s.index >= last) {
            // End of the script. Settle only once the request has resolved; otherwise hold
            // here, so the user never sees a finished script with no answer under it.
            if (resolved.current) return { ...s, phase: 'done', holding: false };
            return { ...s, holding: true };
          }
          tick();
          return { ...s, index: s.index + 1, holding: false };
        });
      },
      resolved.current ? FAST_MS : STEP_MS,
    );
  }, [clear]);

  const start = useCallback(
    (scriptId?: string) => {
      clear();
      resolved.current = false;
      const script = (scriptId ? scriptById(scriptId) : undefined) ?? pickProgressScript(lastId.current);
      lastId.current = script.id;
      setState({ script, index: 0, phase: 'running', holding: false });
      tick();
      return script;
    },
    [clear, tick],
  );

  const finish = useCallback(() => {
    resolved.current = true;
    let settled = false;
    setState((s) => {
      if (!s.script) return s;
      if (s.index >= s.script.steps.length - 1) {
        settled = true;
        return { ...s, phase: 'done', holding: false };
      }
      return { ...s, phase: 'finishing' };
    });
    if (settled) clear();
    else tick();
  }, [clear, tick]);

  const cancel = useCallback(() => {
    clear();
    resolved.current = false;
    setState({ script: null, index: 0, phase: 'idle', holding: false });
  }, [clear]);

  return { ...state, start, finish, cancel };
}
