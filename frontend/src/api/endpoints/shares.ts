/**
 * Public share links (`docs/API.md` §12). No login: anyone with the slug can read the snapshot.
 *
 *   GET /api/shares/{slug}             -> SharedRun (404 unknown, 410 expired or revoked)
 *   GET /api/shares/{slug}/report.pdf  -> the same snapshot as a PDF
 */

import { API_BASE } from '../config';
import { ApiError, request } from '../http';
import { usingFixtures } from '../config';
import type { components } from '../schema';

export type SharedRun = components['schemas']['SharedRun'];

export const sharesApi = {
  /** GET /api/shares/{slug} */
  get: (slug: string, signal?: AbortSignal): Promise<SharedRun> =>
    request<SharedRun>({
      method: 'GET',
      path: `/shares/${encodeURIComponent(slug)}`,
      signal,
      ...(usingFixtures()
        ? {
            fixture: (): SharedRun => {
              throw new ApiError('Share links need the real backend', 'http', 404);
            },
          }
        : {}),
    }),

  /** Public PDF of a shared run; a plain link works, no header needed. */
  reportUrl: (slug: string): string => `${API_BASE}/shares/${encodeURIComponent(slug)}/report.pdf`,
};
