/**
 * "Ask your watches" — a short written answer across the user's watches, or about one of them.
 *
 * The prototype hardcoded this prose in the page component (several paragraphs of invented
 * findings about specific fields). It is an agent output, so it belongs behind an endpoint.
 */

import { request } from '../http';
import * as fixtures from '../fixtures';
import type { InsightDto, InsightRequest } from '../types';

export const insightsApi = {
  /** TODO(api): POST /api/ask/insights */
  ask: (body: InsightRequest, signal?: AbortSignal): Promise<InsightDto> =>
    request<InsightDto>({
      method: 'POST',
      path: '/ask/insights',
      body,
      signal,
      fixture: () => fixtures.insight(body),
    }),
};
