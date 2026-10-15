// Tiny fetch wrapper. Every failure becomes an ApiError with a code the UI
// can switch on and a message it can show as-is.

export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, any> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function buildUrl(path: string, query?: Query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `/api${path}${qs ? `?${qs}` : ''}`;
}

async function request<T>(method: 'GET' | 'POST', url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  // 25 s ceiling so a stuck server never leaves a screen loading forever
  const timeout = AbortSignal.timeout(25_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    res = await fetch(url, {
      method,
      signal: combined,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (timeout.aborted && !signal?.aborted) {
      throw new ApiError(0, 'TIMEOUT', 'The server took too long to answer. The database may be busy or down. Try again.');
    }
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the API server. Check that it is running (cd api && npm start).');
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON (e.g. proxy error page)
  }
  if (!res.ok) {
    const e = payload?.error;
    if (e) throw new ApiError(res.status, e.code, e.message, e.details);
    if (res.status === 502 || res.status === 504) {
      throw new ApiError(res.status, 'NETWORK', 'The API server is not responding. Check that it is running on port 4000.');
    }
    throw new ApiError(res.status, 'HTTP_' + res.status, `Request failed (${res.status}).`);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', buildUrl(path, query), undefined, signal),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', buildUrl(path), body),
};
