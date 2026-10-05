// Mirrors the backend's Role enum (staff only — admin/dispatcher/driver
// share one `users` table; see PROJECT.md Section 3). Customer portal login
// is a separate model/token type and isn't wired into this frontend yet.
export type Role = 'admin' | 'dispatcher' | 'driver';

// Matches AuthService.SafeUser on the backend (the User row minus passwordHash).
export interface AuthUser {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}
