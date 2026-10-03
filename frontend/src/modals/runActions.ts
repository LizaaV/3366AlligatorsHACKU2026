/**
 * The three real things a finished run can be turned into: a PDF report, a public share link
 * and a note saved against the place. Shared by the answer card and the export modal so both
 * say the same thing when something goes wrong.
 */

import { api, toApiError } from '../api';

/** A message a person can act on, for the run-level actions (PDF, share, save to place). */
export function runActionError(err: unknown, what: 'pdf' | 'share' | 'insight'): string {
  const e = toApiError(err);
  const kind = e.kind as string;
  if (kind === 'conflict' || e.status === 409) {
    return what === 'insight'
      ? 'This answer could not be saved yet. Wait for the run to finish, then try again.'
      : 'The report is only ready once the run has finished. Try again in a moment.';
  }
  if (kind === 'rate_limited' || e.status === 429) return 'Too many requests just now. Wait a few seconds and try again.';
  if (e.status === 404) return 'This run is no longer available on the server. Ask the question again to get a fresh answer.';
  if (kind === 'not_available' || kind === 'not-implemented' || e.status === 501) return 'This is not available on this server yet.';
  if (kind === 'unavailable' || e.status === 503) return 'The server is busy right now. Try again shortly.';
  return e.userMessage;
}

/** Download the run's PDF report (GET /api/runs/{id}/report.pdf). Resolves to an error message, or null. */
export async function downloadRunReport(runId: string): Promise<string | null> {
  try {
    await api.runs.downloadReport(runId);
    return null;
  } catch (err) {
    return runActionError(err, 'pdf');
  }
}

/** The server may answer with a path (`/proof/<slug>`); a link people paste elsewhere needs the origin. */
export function absoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return url;
  }
}

/** Copy text to the clipboard; false when the browser refuses (insecure origin, permissions). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
