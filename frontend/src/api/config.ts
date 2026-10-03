/** Runtime configuration for the API layer. See `frontend/.env.example`. */

export type ApiSource = 'fixture' | 'http';

/** In dev this stays `/api`, which vite.config.ts proxies to the FastAPI server on :8000. */
export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

/**
 * `fixture` while the backend is being built: endpoints resolve from `src/api/fixtures/`
 * instead of the network. Set `VITE_API_SOURCE=http` to force real calls.
 *
 * This is a whole-app switch for convenience. The real migration happens per endpoint: when a
 * backend route goes live, delete that endpoint's `fixture` callback and it becomes a network
 * call regardless of this setting.
 */
export const API_SOURCE: ApiSource = import.meta.env.VITE_API_SOURCE === 'http' ? 'http' : 'fixture';

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Fixture responses resolve after this delay so loading states and skeletons are exercised in
 * development rather than appearing for one frame. Real network latency replaces it.
 */
export const FIXTURE_LATENCY_MS = num(import.meta.env.VITE_FIXTURE_LATENCY_MS, 500);

/** Set between 0 and 1 to make fixture requests fail at random, to exercise error states. */
export const FIXTURE_ERROR_RATE = Math.min(1, Math.max(0, num(import.meta.env.VITE_FIXTURE_ERROR_RATE, 0)));

/** Requests abort after this long. */
export const REQUEST_TIMEOUT_MS = 30_000;

export const usingFixtures = () => API_SOURCE === 'fixture';

/**
 * Force the synthesised fixture run to ask a clarifying question.
 *
 * The stub backend never asks one (`docs/API.md` §4), and the real flow arrives with the agent
 * loop in module A3. Without this the clarification UI could not be exercised at all before
 * then, so set `VITE_FIXTURE_CLARIFY=1` to make fixture runs pause for the user once.
 */
export const FIXTURE_CLARIFY = import.meta.env.VITE_FIXTURE_CLARIFY === '1';
