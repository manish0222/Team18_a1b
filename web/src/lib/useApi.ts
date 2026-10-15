import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

type Query = Record<string, string | number | boolean | null | undefined>;

export interface ApiState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  /** true while a request is in flight (also during refetch) */
  loading: boolean;
  /** true only before the first successful response */
  initialLoading: boolean;
  reload: () => void;
}

/**
 * GET `path` whenever path/query change. Keeps the previous data while a new
 * page loads (no flashing tables), cancels stale requests, exposes reload().
 * Pass path = null to skip fetching.
 */
export function useApi<T>(path: string | null, query?: Query, opts: { pollMs?: number } = {}): ApiState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<ApiError>();
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const key = path === null ? null : path + JSON.stringify(query ?? {});
  const hasData = useRef(false);

  useEffect(() => {
    if (key === null || path === null) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    api
      .get<T>(path, query, controller.signal)
      .then((d) => {
        hasData.current = true;
        setData(d);
        setError(undefined);
      })
      .catch((e) => {
        if (e?.name === 'AbortError') return;
        setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', String(e?.message ?? e)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  useEffect(() => {
    if (!opts.pollMs || key === null) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    }, opts.pollMs);
    return () => window.clearInterval(id);
  }, [opts.pollMs, key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, initialLoading: loading && !hasData.current, reload };
}
