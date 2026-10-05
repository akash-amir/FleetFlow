'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/auth-context';
import { TopBar } from '@/features/shell/components/top-bar';
import { SideNav } from '@/features/shell/components/side-nav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Wait for the one-time silent-refresh attempt to actually finish
    // before deciding there's no session — redirecting while isLoading is
    // still true would send someone with a perfectly valid session to
    // /login, flashing it unnecessarily before bouncing them right back.
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">Loading…</div>;
  }

  if (!user) {
    // The redirect above is already in flight — render nothing rather than
    // flash protected content before it completes.
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <div className="flex flex-1">
        <SideNav />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
