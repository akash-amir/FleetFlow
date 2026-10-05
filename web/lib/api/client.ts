import { ApiError } from './api-error';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface ApiFetchOptions {
  method?: HttpMethod;
  body?: unknown;
  /** Set on calls that must never trigger the refresh-and-retry dance below — currently only login (a 401 there just means "wrong credentials", not "expired session"). */
  skipAuthRetry?: boolean;
}

// The access token lives only in memory, for exactly as long as this module
// is loaded (i.e. the tab's lifetime) — see features/auth/auth-context.tsx
// for why. Every other module that needs to call the API reads it from
// here via apiFetch; nothing stores it in localStorage or a readable cookie.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export interface RawAuthResponse {
  accessToken: string;
  user: Record<string, unknown>;
}

let refreshPromise: Promise<RawAuthResponse | null> | null = null;

/**
 * Single-flight: the app's one-time startup session restore
 * (AuthProvider) and apiFetch's own automatic retry-on-401 (below) can both
 * want a fresh token at nearly the same moment — e.g. the token expires
 * right as two list views each fire a request. Without coalescing, that's
 * two concurrent POST /auth/refresh calls racing on the same refresh-token
 * cookie. The backend's rotation treats a second use of an already-rotated
 * refresh token as reuse/theft and revokes the whole token family (see
 * Module 2 / auth.service.ts), which would silently log the user out for
 * no reason other than bad luck in a race. Every caller here shares the
 * same in-flight promise instead, so only one refresh is ever outstanding.
 */
export function refreshAccessToken(): Promise<RawAuthResponse | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefresh(): Promise<RawAuthResponse | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RawAuthResponse;
    setAccessToken(data.accessToken);
    return data;
  } catch {
    return null;
  }
}

async function rawFetch(path: string, method: HttpMethod, body: unknown): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // The refresh token is an httpOnly cookie the backend sets on
    // login/refresh — the browser only attaches it automatically if every
    // request asks for credentials, including cross-origin ones (the
    // frontend and API run on different ports in dev). This assumes the
    // backend's CORS config (FRONTEND_ORIGIN) explicitly allows this
    // origin AND sets `credentials: true` — the backend's current CORS
    // setup needs checking against that; not changed here.
    credentials: 'include',
  });
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    // NestJS's default exception shape is `{ statusCode, message, error }`,
    // where `message` is a plain string for most exceptions but an array of
    // strings for class-validator failures (ValidationPipe) — both are
    // flattened to one string here.
    const message = Array.isArray(data?.message) ? data.message.join(', ') : (data?.message ?? res.statusText);
    throw new ApiError(res.status, message);
  }

  return data as T;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = 'GET', body, skipAuthRetry = false } = options;

  const res = await rawFetch(path, method, body);

  if (res.status === 401 && !skipAuthRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const retryRes = await rawFetch(path, method, body);
      return parseResponse<T>(retryRes);
    }
  }

  return parseResponse<T>(res);
}
