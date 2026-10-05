'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authService } from './services/auth.service';
import type { AuthUser } from './types/auth.types';

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the one-time startup session-restore attempt has resolved (success or failure). */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// The access token is kept in memory only (see lib/api/client.ts) — NOT
// localStorage, and not a readable cookie:
//   - localStorage is readable by any script on the page, so a single XSS
//     bug anywhere in the app (ours or a dependency's) can read it and
//     impersonate the user indefinitely, from anywhere, even after the tab
//     closes. An in-memory variable disappears the instant the tab does.
//   - The refresh token is the one credential that actually needs to
//     survive a reload, and that already lives in an httpOnly cookie the
//     browser itself won't expose to JS — the backend sets it, this
//     frontend never touches its value directly.
// Each fresh tab reload re-derives the access token from that cookie via
// the silent refresh below, which is the entire reason that attempt exists.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // A fresh tab with no prior session is the normal case, not an error —
    // authService.refresh() resolves to null on any failure, so nothing is
    // ever shown to the user here.
    authService.refresh().then((restoredUser) => {
      if (cancelled) return;
      setUser(restoredUser);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const loggedInUser = await authService.login(email, password);
    setUser(loggedInUser);
  }, []);

  const logout = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, isLoading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
