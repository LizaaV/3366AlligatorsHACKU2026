/**
 * Turn a stored run (from a reloaded thread) back into a turn the chat can render, including
 * paused (`waiting_user`) runs.
 */

import type { AskTurn } from '../../ask/useAskRun';
import { toAnswer, type RunStep } from '../../model';
import type { RunRecord, ThreadDetail } from '../../api';

export function turnFromRecord(r: RunRecord): AskTurn {
  const answer = r.answer ? toAnswer(r.answer) : undefined;
  const events = r.events ?? [];
  const steps: RunStep[] = (r.steps ?? []).map((s) => ({
    index: s.index,
    tool: s.tool,
    title: s.title,
    desc: s.desc,
    result: s.result ?? null,
    ms: s.ms ?? null,
    error: s.error ?? null,
    done: true,
  }));

  const waiting = r.status === 'waiting_user';
  const last = <E extends (typeof events)[number]['event']>(name: E) =>
    [...events].reverse().find((e): e is Extract<(typeof events)[number], { event: E }> => e.event === name);
  // The pending questions are the last `clarification_needed` event of a paused run.
  const clarification = waiting ? (last('clarification_needed') ?? null) : null;
  const guard = last('guard');
  const done = last('done');

  return {
    id: r.run_id,
    text: r.question,
    placeId: r.place_ids?.[0] ?? null,
    area: null,
    // This chat page does not follow runs it did not start, so a run still going on the
    // server shows as unfinished instead of a spinner that never stops.
    phase: waiting ? 'clarify' : r.status === 'running' || r.status === 'failed' ? 'error' : 'done',
    runId: r.run_id,
    threadId: r.thread_id,
    steps,
    blocks: (r.blocks?.length ? r.blocks : answer?.blocks) ?? [],
    clarification,
    // Prefill only what the server knows, as a live stream does.
    answers: Object.fromEntries((clarification?.questions ?? []).flatMap((q) => (q.value ? [[q.key, q.value] as const] : []))),
    remember: clarification?.remember ?? false,
    guard: guard && guard.scope !== 'answerable' ? guard : null,
    open: waiting,
    status: r.status,
    answer,
    streamError:
      last('error') ??
      (r.status === 'running'
        ? { event: 'error', message: 'This answer was still being worked on. Ask again to get it.', recoverable: false }
        : undefined),
    durationMs: done?.ms ?? 0,
  } satisfies AskTurn;
}

export const turnsFromThread = (detail: ThreadDetail): AskTurn[] => detail.runs.map(turnFromRecord);
