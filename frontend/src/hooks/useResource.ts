/**
 * Minimal async-resource hook: loading / error / data, with retry and abort.
 *
 * Deliberately shaped like TanStack Query's `useQuery` result (`data`, `error`, `isLoading`,
 * `refetch`) so swapping the real library in later is a mechanical change rather than a
 * rewrite of every call site. What this does NOT do, and what TanStack Query would give you:
 * a shared cache across components, request deduplication, background refetching, stale-while-
 * revalidate, and automatic invalidation after mutations.
 *
 * That is a deliberate trade: no new dependency until the team signs off on one (adding deps
 * means a lockfile change, which COLLABORATION.md §5 wants in its own small PR).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, toApiError } from '../api';

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | undefined;
  /** First load, with nothing to show yet. */
  isLoading: boolean;
  /** Any load in flight, including a refetch over existing data. */
  isFetching: boolean;
  refetch: () => void;
}

/**
 * @param fetcher receives an AbortSignal; must be stable (wrap in useCallback) or it will
 *   refetch on every render.
 * @param deps re-fetch when these change, like useEffect deps.
 */
export function useResource<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [isFetching, setFetching] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loaded = useRef(false);

  useEffect(() => {
    const ac = new AbortController();
    let live = true;
    setFetching(true);
    setError(undefined);

    fetcher(ac.signal)
      .then((value) => {
        if (!live) return;
        loaded.current = true;
        setData(value);
      })
      .catch((err) => {
        if (!live) return;
        const api = toApiError(err);
        if (api.kind === 'aborted') return;
        setError(api);
      })
      .finally(() => {
        if (live) setFetching(false);
      });

    return () => {
      live = false;
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, isLoading: isFetching && !loaded.current, isFetching, refetch };
}
