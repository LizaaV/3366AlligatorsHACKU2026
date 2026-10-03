/**
 * Exports. The backend has no generic `/api/export`; what exists is per run:
 *   - PDF report: `api.runs.downloadReport(runId)` / `api.runs.reportUrl(runId)`
 *   - share link: `api.runs.share(runId)`
 * `create` therefore always rejects with kind `not_available` (no request is made).
 */

import { notAvailable } from '../http';
import type { ExportRequest, ExportResponse } from '../types';

export const exportsApi = {
  create: (_body: ExportRequest, _signal?: AbortSignal): Promise<ExportResponse> => notAvailable('Export'),
};
