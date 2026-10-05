import { apiFetch, refreshAccessToken, setAccessToken } from '@/lib/api/client';
import type { AuthUser } from '../types/auth.types';

interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export const authService = {
  async login(email: string, password: string): Promise<AuthUser> {
    // skipAuthRetry: a 401 here means "wrong credentials", not "expired
    // session" — there's no session to refresh yet.
    const result = await apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuthRetry: true,
    });
    setAccessToken(result.accessToken);
    return result.user;
  },

  /**
   * Restores a session from the httpOnly refresh cookie — used both for the
   * app's one-time silent restore on load and (via the same single-flight
   * function) by apiFetch's automatic retry-on-401. Returns null on any
   * failure; the caller treats that as "logged out", never as an error to
   * surface.
   */
  async refresh(): Promise<AuthUser | null> {
    const result = await refreshAccessToken();
    return (result?.user as AuthUser | undefined) ?? null;
  },

  async logout(): Promise<void> {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      // Always clear the local token, even if the network call failed —
      // the user asked to log out of THIS tab, and that much is always
      // achievable client-side regardless of what the server says.
      setAccessToken(null);
    }
  },

  me(): Promise<AuthUser> {
    return apiFetch<AuthUser>('/auth/me');
  },
};
