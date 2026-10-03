/** Turn a reloaded thread (a list of finished runs) back into turns the chat can render. */

import type { AskTurn } from '../../ask/useAskRun';
import { toAnswer } from '../../model';
import type { ThreadDetail } from '../../api';

export function turnsFromThread(detail: ThreadDetail): AskTurn[] {
  return detail.runs.map((r) => {
    const answer = r.answer ? toAnswer(r.answer) : undefined;
    return {
      id: r.run_id,
      text: r.question,
      placeId: r.place_ids?.[0] ?? null,
      point: null,
      phase: r.status === 'failed' || r.status === 'refused' ? 'error' : 'done',
      runId: r.run_id,
      threadId: r.thread_id,
      steps: [],
      blocks: answer?.blocks ?? [],
      clarification: null,
      answers: {},
      remember: false,
      guard: null,
      open: false,
      status: r.status,
      answer,
      durationMs: 0,
    } satisfies AskTurn;
  });
}
