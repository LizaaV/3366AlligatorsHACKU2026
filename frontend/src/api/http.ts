/**
 * The single place the frontend talks to the network.
 *
 * Every endpoint in `endpoints/` goes through `request()`. While the backend is being built,
 * an endpoint may supply a `fixture` callback: a local stand-in that resolves after an
 * artificial delay so components exercise real loading and error states today.
 *
 * To put an endpoint live: delete its `fixture` property. Nothing else changes — same call
 * site, same types, same loading states.
 */

import { API_BASE, FIXTURE_ERROR_RATE, FIXTURE_LATENCY_MS, REQUEST_TIMEOUT_MS, usingFixtures } from './config';
import { identityHeaders } from './identity';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'http'
  | 'parse'
  /** 501 from the server: the route exists but is not built. */
  | 'not-implemented'
  /** The backend has no such endpoint at all; thrown locally, no request is made. */
  | 'not_available'
  /** 429: too many runs. `retryAfterS` says how long to wait. */
  | 'rate_limited'
  /** 409: e.g. a conversation that is full, or replying to a run that is not waiting. */
  | 'conflict'
  /** 503: the AI model is unavailable or the daily budget is spent. */
  | 'unavailable'
  | 'aborted';

/** Thrown for every failure, so callers have one error type to handle. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    /** HTTP status, when there was a response. */
    readonly status?: number,
    /** Parsed response body, when there was one. */
    readonly body?: unknown,
    /** Seconds to wait before retrying, from `Retry-After` (429). */
    readonly retryAfterS?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /**
   * The server's own explanation, when it sent one: FastAPI's `detail` string, or the
   * `message` (plus `hint`) of a structured `{kind, message, hint}` detail.
   */
  get detail(): string | null {
    const b = this.body as { detail?: unknown } | string | undefined;
    if (typeof b === 'string') return b.length < 300 && !b.trimStart().startsWith('<') ? b : null;
    const d = b && typeof b === 'object' ? b.detail : undefined;
    if (typeof d === 'string') return d;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const { message, hint } = d as { message?: unknown; hint?: unknown };
      if (typeof message === 'string') return typeof hint === 'string' && hint ? `${message} ${hint}` : message;
    }
    return null;
  }

  /** Message safe to show a user. */
  get userMessage(): string {
    switch (this.kind) {
      case 'network':
        return 'Could not reach the server. Check your connection and try again.';
      case 'timeout':
        return 'The server took too long to respond. Try again.';
      case 'not-implemented':
        return 'This is not connected to the backend yet.';
      case 'not_available':
        return 'Not available yet';
      case 'rate_limited': {
        const s = this.retryAfterS;
        if (s === undefined) return this.detail ?? 'Too many questions just now. Wait a moment and try again.';
        if (s < 60) return `Too many questions at once — try again in ${Math.max(1, Math.ceil(s))} s.`;
        return `You've asked a lot in the last hour — try again in ${Math.ceil(s / 60)} min.`;
      }
      case 'conflict':
        // e.g. "This conversation is full; start a new one (omit thread_id)." — drop the dev hint.
        return (
          this.detail?.replace(/\s*\([^)]*\b\w+_id\)/, '') ??
          'That could not be done in the current state. Refresh and try again.'
        );
      case 'unavailable':
        return this.detail ?? 'The analysis service is not available right now. Try again later.';
      case 'http':
        if (this.status === 404) return 'That could not be found.';
        if (this.status === 401 || this.status === 403) return 'You do not have access to that.';
        if (this.status === 410) return this.detail ?? 'This link has expired or was revoked.';
        if (this.status === 400 && this.detail) return this.detail;
        if (this.status && this.status >= 500) return 'Something went wrong on the server. Try again shortly.';
        return 'That request could not be completed.';
      default:
        return 'Something went wrong. Try again.';
    }
  }

  /** Whether retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'rate_limited' ||
      this.kind === 'unavailable' ||
      (this.kind === 'http' && (this.status ?? 0) >= 500)
    );
  }
}

/** `Retry-After` is seconds, or an HTTP date. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n)) return Math.max(0, n);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, (at - Date.now()) / 1000);
}

/** Build the ApiError for a non-2xx response. Shared by `request()` and the SSE reader. */
export function errorFromResponse(label: string, res: Response, payload: unknown): ApiError {
  const status = res.status;
  const kind: ApiErrorKind =
    status === 501
      ? 'not-implemented'
      : status === 429
        ? 'rate_limited'
        : status === 409
          ? 'conflict'
          : status === 503
            ? 'unavailable'
            : 'http';
  return new ApiError(
    `${label} failed with ${status}`,
    kind,
    status,
    payload,
    status === 429 || status === 503 ? parseRetryAfter(res.headers.get('retry-after')) : undefined,
  );
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new ApiError('Aborted', 'aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new ApiError('Aborted', 'aborted'));
    });
  });

export const buildUrl = (path: string, query?: RequestOptions['query']) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return `${API_BASE}${path}${s ? `?${s}` : ''}`;
};

export interface RequestOptions<T = unknown> {
  method: HttpMethod;
  /** Path below the API base, e.g. `/places`. */
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
  /** Multipart upload. Mutually exclusive with `body`. */
  form?: FormData;
  /**
   * TEMPORARY local stand-in, used while `VITE_API_SOURCE=fixture` and this endpoint has no
   * backend yet. Delete this property to put the endpoint live.
   */
  fixture?: () => T | Promise<T>;
}

export async function request<T>(opts: RequestOptions<T>): Promise<T> {
  const { method, path, query, body, form, signal, fixture } = opts;

  if (fixture && usingFixtures()) {
    await sleep(FIXTURE_LATENCY_MS, signal);
    if (FIXTURE_ERROR_RATE > 0 && Math.random() < FIXTURE_ERROR_RATE) {
      throw new ApiError(`Simulated fixture failure for ${method} ${path}`, 'http', 503);
    }
    return await fixture();
  }

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      signal: timeout.signal,
      headers: form
        ? { ...identityHeaders(), accept: 'application/json' }
        : { ...identityHeaders(), 'content-type': 'application/json', accept: 'application/json' },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (err) {
    if (signal?.aborted) throw new ApiError('Request aborted', 'aborted');
    if (timeout.signal.aborted) throw new ApiError(`${method} ${path} timed out`, 'timeout');
    throw new ApiError(`${method} ${path} could not reach the server`, 'network', undefined, err);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  const payload = await readBody(res);

  if (!res.ok) {
    throw errorFromResponse(`${method} ${path}`, res, payload);
  }
  return payload as T;
}

export async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text().catch(() => '');
  if (!text) return undefined;
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) return text;
  try {
    return JSON.parse(text);
  } catch {
    if (res.ok) throw new ApiError('Server returned invalid JSON', 'parse', res.status, text);
    return text;
  }
}

/**
 * Marker for an endpoint that has no backend *and* no fixture — it is known to be unbuilt.
 * Calling it throws a clear error rather than failing mysteriously at the network layer.
 */
export const notImplemented = (what: string): never => {
  throw new ApiError(`${what} is not implemented yet`, 'not-implemented', 501);
};

/**
 * For an endpoint the backend does not have (and may never have in this form). Throws
 * locally — no network request — so the UI shows "Not available yet" instead of a 404.
 */
export const notAvailable = (what: string): Promise<never> =>
  Promise.reject(new ApiError('Not available yet', 'not_available', undefined, { detail: `${what} is not available yet` }));

export const toApiError = (err: unknown): ApiError =>
  err instanceof ApiError ? err : new ApiError(err instanceof Error ? err.message : String(err), 'network');
