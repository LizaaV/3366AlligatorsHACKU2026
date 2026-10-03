/**
 * Who this browser is, as far as the backend knows.
 *
 * There are no accounts (`docs/API.md` §1): every request without `X-User-Id` is the shared
 * user `"demo"`, so every visitor would share one history and one hourly rate limit. Instead
 * each browser gets a random id once, kept in localStorage, and sends it on every request.
 *
 * `VITE_USER_ID` pins the id (e.g. `demo`, which is the only user the backend seeds with the
 * Hoo Hok Wai place). Otherwise a fresh visitor starts with no saved places.
 */

/** Same rule as the backend's `USER_ID_PATTERN` (backend/app/schemas/runs.py). */
const USER_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const STORAGE_KEY = 'constellation.userId';

let cached: string | null = null;

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  try {
    crypto.getRandomValues(buf);
  } catch {
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The id sent as `X-User-Id`. Stable for this browser; never throws. */
export function userId(): string {
  if (cached) return cached;

  const pinned = String(import.meta.env.VITE_USER_ID ?? '').trim().toLowerCase();
  if (pinned && USER_ID_RE.test(pinned)) return (cached = pinned);

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && USER_ID_RE.test(stored)) return (cached = stored);
  } catch {
    /* storage unavailable (private window, blocked site data): fall through to memory */
  }

  const fresh = `u_${randomHex(8)}`;
  try {
    localStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    /* keep it in memory for this page load */
  }
  return (cached = fresh);
}

/** Headers every request carries. */
export const identityHeaders = (): Record<string, string> => ({ 'X-User-Id': userId() });
