/**
 * Conversations (threads): the chat history sidebar (`docs/API.md` §7b).
 *
 *   GET /api/threads?limit=20     -> ThreadSummary[], newest first
 *   GET /api/threads/{thread_id}  -> ThreadDetail: every run, oldest first, with answers,
 *                                    blocks and event logs to redraw it exactly
 *
 * Scoped to the caller's `X-User-Id`. Fixture mode has no history: `list` resolves empty and
 * `get` rejects with 404.
 */

import { ApiError, request } from '../http';
import { usingFixtures } from '../config';
import type { components } from '../schema';

type S = components['schemas'];

export type ThreadSummary = S['ThreadSummary'];
export type ThreadDetail = S['ThreadDetail'];

export const threadsApi = {
  /** GET /api/threads */
  list: (signal?: AbortSignal, limit = 20): Promise<ThreadSummary[]> =>
    request<ThreadSummary[]>({
      method: 'GET',
      path: '/threads',
      query: { limit },
      signal,
      ...(usingFixtures() ? { fixture: (): ThreadSummary[] => [] } : {}),
    }),

  /** GET /api/threads/{thread_id} */
  get: (threadId: string, signal?: AbortSignal): Promise<ThreadDetail> =>
    request<ThreadDetail>({
      method: 'GET',
      path: `/threads/${encodeURIComponent(threadId)}`,
      signal,
      ...(usingFixtures()
        ? {
            fixture: (): ThreadDetail => {
              throw new ApiError(`No thread ${threadId}`, 'http', 404);
            },
          }
        : {}),
    }),

  /** PATCH /api/threads/{thread_id}: move a chat into a project, or out with `null`. */
  setProject: (threadId: string, projectId: string | null, signal?: AbortSignal): Promise<ThreadSummary> =>
    request<ThreadSummary>({
      method: 'PATCH',
      path: `/threads/${encodeURIComponent(threadId)}`,
      body: { project_id: projectId },
      signal,
      ...(usingFixtures()
        ? {
            fixture: (): ThreadSummary => {
              throw new ApiError(`No thread ${threadId}`, 'http', 404);
            },
          }
        : {}),
    }),
};
