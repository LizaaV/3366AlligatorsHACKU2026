/**
 * "Ask your watches" — a short written answer across the user's watches, or about one of them.
 *
 * The backend has no `/api/ask/insights`. In http mode `ask` rejects with kind
 * `not_available` (no request is made); fixture mode keeps the local stand-in. Saving an
 * answer's insight to a place is a different thing: `api.runs.saveInsight`.
 */

import { notAvailable, request } from '../http';
import { usingFixtures } from '../config';
import * as fixtures from '../fixtures';
import type { InsightDto, InsightRequest } from '../types';

export const insightsApi = {
  ask: (body: InsightRequest, signal?: AbortSignal): Promise<InsightDto> =>
    usingFixtures()
      ? request<InsightDto>({
          method: 'POST',
          path: '/ask/insights',
          body,
          signal,
          fixture: () => fixtures.insight(body),
        })
      : notAvailable('Asking across watches'),
};
