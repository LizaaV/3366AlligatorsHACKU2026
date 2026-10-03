/** Exports: shareable links, PDF reports and data packs. */

import { request } from '../http';
import type { ExportRequest, ExportResponse } from '../types';

export const exportsApi = {
  /**
   * TODO(api): POST /api/export
   * No fixture: there is nothing honest to stand in for a generated file, and returning a fake
   * link would be worse than a clear "not connected yet". The modal catches the
   * `not-implemented` error and says so.
   */
  create: (body: ExportRequest, signal?: AbortSignal): Promise<ExportResponse> =>
    request<ExportResponse>({ method: 'POST', path: '/export', body, signal }),
};
