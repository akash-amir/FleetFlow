'use client';

import { useAuth } from '@/features/auth/auth-context';
import { RequireRole } from '@/features/auth/components/require-role';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <RequireRole roles={['admin', 'dispatcher']} fallback={<p>You do not have access to this page.</p>}>
      <h1 className="text-xl font-semibold">
        Welcome, {user?.fullName} ({user?.role})
      </h1>
    </RequireRole>
  );
}
