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

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Thrown for every failure, so callers have one error type to handle. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'timeout' | 'http' | 'parse' | 'not-implemented' | 'aborted',
    /** HTTP status, when there was a response. */
    readonly status?: number,
    /** Parsed response body, when there was one. */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
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
      case 'http':
        if (this.status === 404) return 'That could not be found.';
        if (this.status === 401 || this.status === 403) return 'You do not have access to that.';
        if (this.status && this.status >= 500) return 'Something went wrong on the server. Try again shortly.';
        return 'That request could not be completed.';
      default:
        return 'Something went wrong. Try again.';
    }
  }

  /** Whether retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout' || (this.kind === 'http' && (this.status ?? 0) >= 500);
  }
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

const buildUrl = (path: string, query?: RequestOptions['query']) => {
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
  /** Override REQUEST_TIMEOUT_MS for a call that legitimately takes longer (satellite reads). */
  timeoutMs?: number;
  /**
   * TEMPORARY local stand-in, used while `VITE_API_SOURCE=fixture` and this endpoint has no
   * backend yet. Delete this property to put the endpoint live.
   */
  fixture?: () => T | Promise<T>;
}

export async function request<T>(opts: RequestOptions<T>): Promise<T> {
  const { method, path, query, body, form, signal, fixture, timeoutMs } = opts;

  if (fixture && usingFixtures()) {
    await sleep(FIXTURE_LATENCY_MS, signal);
    if (FIXTURE_ERROR_RATE > 0 && Math.random() < FIXTURE_ERROR_RATE) {
      throw new ApiError(`Simulated fixture failure for ${method} ${path}`, 'http', 503);
    }
    return await fixture();
  }

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs ?? REQUEST_TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      signal: timeout.signal,
      headers: form ? undefined : { 'content-type': 'application/json', accept: 'application/json' },
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
    throw new ApiError(
      `${method} ${path} failed with ${res.status}`,
      res.status === 501 ? 'not-implemented' : 'http',
      res.status,
      payload,
    );
  }
  return payload as T;
}

async function readBody(res: Response): Promise<unknown> {
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

export const toApiError = (err: unknown): ApiError =>
  err instanceof ApiError ? err : new ApiError(err instanceof Error ? err.message : String(err), 'network');
