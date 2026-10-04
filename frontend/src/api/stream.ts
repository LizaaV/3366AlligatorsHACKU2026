/**
 * Server-sent-event reader for the two streaming run endpoints.
 *
 * `POST /api/runs` and `POST /api/runs/{id}/reply` return `text/event-stream`. The browser's
 * built-in `EventSource` only does GET, and both of these POST, so the stream is read with
 * `fetch` and decoded here. See `docs/API.md` §3.
 *
 * Framing rules this implements, from the contract:
 *   - a message is an `event:` line plus a `data:` line, messages separated by a blank line
 *   - lines end with CRLF, so they are normalised to LF before splitting
 *   - every payload also carries its own `event` field, so the `event:` line is ignored and
 *     only `data` is parsed
 *   - lines starting with `:` are keep-alive pings and carry no data
 *   - every stream ends with exactly one `done`
 *
 * Failures *before* the stream opens are ordinary JSON HTTP errors (400/404/422/501) and are
 * thrown as `ApiError`. Once the stream is open, problems arrive as `error` events instead —
 * see §8 — so a caller must handle both.
 */

import { API_BASE } from './config';
import { ApiError, errorFromResponse, readBody } from './http';
import { identityHeaders } from './identity';
import type { components } from './schema';

type S = components['schemas'];

/** The eleven events the contract defines, discriminated on `event`. */
export type StreamEvent =
  | S['RunStarted']
  | S['GuardEvent']
  | S['HypothesesRegistered']
  | S['ClarificationNeeded']
  | S['ClarificationAnswered']
  | S['StepStarted']
  | S['StepFinished']
  | S['BlockReady']
  | S['AnswerEvent']
  | S['ErrorEvent']
  | S['Done'];

export type StreamEventName = StreamEvent['event'];

/** Narrow a received event by name, keeping the generated payload type. */
export const isEvent = <N extends StreamEventName>(
  ev: StreamEvent,
  name: N,
): ev is Extract<StreamEvent, { event: N }> => ev.event === name;

/**
 * POST `body` to `path` and invoke `onEvent` for each decoded event, in arrival order.
 *
 * Resolves when the server closes the stream. Aborting via `signal` rejects with an
 * `aborted` ApiError, which callers treat as "the user navigated away", not a failure —
 * the server records how the run ended.
 */
export async function streamSse(
  path: string,
  body: unknown,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { ...identityHeaders(), 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw new ApiError('Run aborted', 'aborted');
    throw new ApiError(`POST ${path} could not reach the server`, 'network', undefined, err);
  }

  // Errors before the stream starts are plain JSON (400/404/409/422/429/501/503), so read and
  // surface the detail. 429 carries Retry-After; 409 is e.g. "This conversation is full".
  if (!res.ok) {
    const payload = await readBody(res).catch(() => undefined);
    throw errorFromResponse(`POST ${path}`, res, payload);
  }
  if (!res.body) throw new ApiError(`POST ${path} returned no body`, 'parse', res.status);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let sawDone = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // Normalise the whole buffer, not the chunk: a CRLF can be split across two chunks.
      buffer = (buffer + value).replace(/\r\n/g, '\n');
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const message = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const data = dataOf(message);
        // Ping lines (':' comments) carry no data field.
        if (!data) continue;
        let parsed: StreamEvent;
        try {
          parsed = JSON.parse(data) as StreamEvent;
        } catch {
          throw new ApiError(`${path} sent an event that was not JSON`, 'parse', res.status, data);
        }
        if (parsed.event === 'done') sawDone = true;
        onEvent(parsed);
      }
    }
  } catch (err) {
    if (signal?.aborted) throw new ApiError('Run aborted', 'aborted');
    throw err instanceof ApiError ? err : new ApiError(`${path} stream failed`, 'network', undefined, err);
  } finally {
    // Releasing the lock lets an aborted fetch tear the connection down promptly.
    reader.releaseLock();
  }

  // Every stream ends with exactly one `done`. Without it the connection dropped mid-run
  // (server restart, proxy timeout), and the caller must not wait forever.
  if (!sawDone) {
    throw new ApiError(`${path} stream ended before the run finished`, 'network', res.status);
  }
}

/** Friendly text for the `error` event kinds the user can do nothing about but wait. */
export function streamErrorMessage(ev: { message: string; kind?: string | null }): string {
  switch (ev.kind) {
    case 'agent_unavailable':
      return 'The analysis agent is not available on this server right now. Try again later, or try the Hoo Hok Wai example.';
    case 'spend_cap':
      return "Today's analysis budget is used up. Try again tomorrow, or try the Hoo Hok Wai example.";
    default:
      return ev.message;
  }
}

/** Join the `data:` lines of one SSE message, dropping the `event:` line and ping comments. */
function dataOf(message: string): string {
  return message
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
}
