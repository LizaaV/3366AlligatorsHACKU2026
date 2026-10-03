/**
 * Share links and the PDF report of a finished run.
 *
 *   POST /api/runs/{run_id}/share      -> ShareCreated (201). No body: the link always expires on
 *                                         the server's schedule and anyone with it can read the
 *                                         snapshot, so there are no access/expiry options to send.
 *   GET  /api/runs/{run_id}/shares     -> ShareInfo[]
 *   GET  /api/runs/{run_id}/report.pdf -> application/pdf (a plain link; see `reportPdfUrl`)
 *
 * No fixtures: a made-up link or file would be worse than an honest error. In fixture mode these
 * calls simply fail with the usual "could not reach the server" message.
 */

import { request } from '../http';
import { API_BASE } from '../config';
import type { PlaceDto } from './places';

export interface ShareCreated {
  slug: string;
  /** Public page, `<PUBLIC_BASE_URL>/proof/<slug>`, built by the server. */
  url: string;
  expires_at: string;
}

export interface ShareInfo extends ShareCreated {
  shared_at: string;
  revoked: boolean;
}

const runPath = (runId: string) => `/runs/${encodeURIComponent(runId)}`;

export const sharesApi = {
  /** POST /api/runs/{run_id}/share — 409 while the run is unfinished. */
  create: (runId: string, signal?: AbortSignal): Promise<ShareCreated> =>
    request<ShareCreated>({ method: 'POST', path: `${runPath(runId)}/share`, signal }),

  /** GET /api/runs/{run_id}/shares */
  list: (runId: string, signal?: AbortSignal): Promise<ShareInfo[]> =>
    request<ShareInfo[]>({ method: 'GET', path: `${runPath(runId)}/shares`, signal }),

  /** URL of the A4 PDF report. Use as a link target: the response is an attachment. */
  reportPdfUrl: (runId: string): string => `${API_BASE}${runPath(runId)}/report.pdf`,

  /**
   * The outline of a saved place as returned by GET /api/places/{id} (`geometry` is real
   * GeoJSON in WGS84). Used for the place's GeoJSON download; the view model keeps only pixels.
   */
  placeDto: (placeId: string, signal?: AbortSignal): Promise<PlaceDto> =>
    request<PlaceDto>({ method: 'GET', path: `/places/${encodeURIComponent(placeId)}`, signal }),
};
