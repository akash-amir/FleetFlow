'use client';

import { useAuth } from '@/features/auth/auth-context';

export function TopBar() {
  const { user, logout } = useAuth();

  return (
    <header className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
      <span className="font-semibold">FleetFlow</span>
      <div className="flex items-center gap-4 text-sm">
        {user && (
          <span className="text-gray-600">
            {user.fullName} <span className="text-gray-400">({user.role})</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded bg-gray-100 px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-200"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
