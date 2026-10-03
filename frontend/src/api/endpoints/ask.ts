/**
 * The agent: ask a question, get an answer.
 *
 * `POST /api/ask` is an ordinary request/response. The step-by-step "agent thinking" reveal is
 * *prewritten in the frontend* (`src/ask/progressScripts.ts`) and played while this request is
 * in flight, so the backend does not need SSE, WebSockets or a job queue.
 *
 * If runs routinely exceed ~20 s, the contract should grow job polling
 * (`POST /ask -> {runId}` + `GET /ask/{runId}`); the progress player already holds on its last
 * step indefinitely, so a slow response degrades gracefully rather than breaking.
 */

import { request } from '../http';
import * as fixtures from '../fixtures';
import type { AnswerTimelineDto, AskRequest, AskResponse } from '../types';
import type { Answer } from '../../model';

export interface AskResult {
  runId: string;
  answer: Answer;
  /** Per-pass timeline for the answer's map overlays, when the answer has any. */
  timeline: AnswerTimelineDto | null;
}

export const askApi = {
  /** TODO(api): POST /api/ask */
  ask: (body: AskRequest, signal?: AbortSignal): Promise<AskResult> =>
    request<AskResponse>({
      method: 'POST',
      path: '/ask',
      body,
      signal,
      fixture: () => {
        const answer = fixtures.ask(body);
        return {
          runId: `run-${Date.now().toString(36)}`,
          // A real answer carries its own timeline; the stand-in attaches the exemplar one.
          answer: answer.kind === 'place' ? { ...answer, timeline: answer.timeline ?? fixtures.timeline() } : answer,
        };
      },
    }).then((res) => ({ runId: res.runId, answer: res.answer, timeline: res.answer.timeline ?? null })),
};
