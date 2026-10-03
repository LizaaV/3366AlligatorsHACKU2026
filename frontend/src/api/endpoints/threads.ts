/**
 * Threads: a user's conversations, each a list of runs that share a `thread_id`.
 *
 *   GET /api/threads?limit=   -> ThreadSummary[], newest first
 *   GET /api/threads/{id}     -> ThreadDetail, oldest run first, to reload it exactly
 *
 * Shapes mirror `backend/app/schemas/threads.py` from PR #49 (`be/threads`). That PR is not
 * merged and `contracts/openapi.json` has no threads yet, so the types are written by hand here
 * and both calls are fixture-backed. When #49 lands: take the types from `schema.d.ts` and
 * delete the `fixture` properties.
 */

import { request } from '../http';
import type { RunRecord } from './runs';
import { FIXTURE_RUN_ANSWER } from '../fixtures/run';

export interface ThreadSummary {
  thread_id: string;
  /** The thread's first question (shortened). */
  title: string;
  /** The place of the latest run, if any. */
  place_name: string | null;
  last_question: string;
  last_status: RunRecord['status'];
  /** The latest answer's one-liner. */
  last_sentence: string | null;
  run_count: number;
  started_at: string;
  updated_at: string;
}

export interface ThreadDetail {
  thread_id: string;
  runs: RunRecord[];
}

export const threadsApi = {
  /** TODO(api): GET /api/threads?limit= (PR #49) */
  list: (limit = 50, signal?: AbortSignal): Promise<ThreadSummary[]> =>
    request<ThreadSummary[]>({
      method: 'GET',
      path: '/threads',
      query: { limit },
      signal,
      fixture: () => FIXTURE_THREADS.slice(0, limit).map(summaryOf),
    }),

  /** TODO(api): GET /api/threads/{id} (PR #49) */
  get: (threadId: string, signal?: AbortSignal): Promise<ThreadDetail> =>
    request<ThreadDetail>({
      method: 'GET',
      path: `/threads/${encodeURIComponent(threadId)}`,
      signal,
      fixture: () => {
        const t = FIXTURE_THREADS.find((x) => x.id === threadId);
        return { thread_id: threadId, runs: t ? t.runs : [] };
      },
    }),
};

/* ------------------------------------------------------------------ fixtures */

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

const run = (threadId: string, n: number, question: string, sentence: string, hoursAgo: number, placeId?: string): RunRecord =>
  ({
    run_id: `${threadId}_r${n}`,
    thread_id: threadId,
    user_id: 'demo',
    place_ids: placeId ? [placeId] : [],
    question,
    lang: 'en',
    status: 'done',
    answer: { ...FIXTURE_RUN_ANSWER, sentence },
    created_at: ago(hoursAgo),
  }) as RunRecord;

const FIXTURE_THREADS: { id: string; place: string | null; runs: RunRecord[] }[] = [
  {
    id: 'th_fixture_dry',
    place: 'North pond',
    runs: [
      run('th_fixture_dry', 1, 'Where are the dry patches in my field?', 'About 4.6 ha of the ponds are now dry, mostly along the eastern edge.', 5),
      run('th_fixture_dry', 2, 'Is that worse than last month?', 'Yes. The dry area has grown by roughly a third since the previous month.', 4.9),
    ],
  },
  {
    id: 'th_fixture_sat',
    place: null,
    runs: [run('th_fixture_sat', 1, 'Which free satellite is best for crop health?', 'Sentinel-2 is the best free choice: 10 m pixels and a new image every five days.', 30)],
  },
  {
    id: 'th_fixture_flood',
    place: null,
    runs: [run('th_fixture_flood', 1, 'How can I map a flood through clouds?', 'Use radar (Sentinel-1): it sees through cloud, so a flood shows up on the first pass.', 52)],
  },
  {
    id: 'th_fixture_fire',
    place: 'Hillside plot',
    runs: [run('th_fixture_fire', 1, 'Any fires within 10 km of this place?', 'No active fires were detected within 10 km in the last 3 days.', 120)],
  },
];

function summaryOf(t: (typeof FIXTURE_THREADS)[number]): ThreadSummary {
  const first = t.runs[0];
  const last = t.runs[t.runs.length - 1];
  return {
    thread_id: t.id,
    title: first.question.length > 60 ? `${first.question.slice(0, 57)}…` : first.question,
    place_name: t.place,
    last_question: last.question,
    last_status: last.status,
    last_sentence: last.answer?.sentence ?? null,
    run_count: t.runs.length,
    started_at: first.created_at ?? ago(0),
    updated_at: last.created_at ?? ago(0),
  };
}
