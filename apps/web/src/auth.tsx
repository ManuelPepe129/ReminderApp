import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { UserDto } from '@reminder/shared';
import { api } from './api/client';
import { keys, useMe } from './api/hooks';
import { browserTimeZone } from './lib/time';

const UserCtx = createContext<UserDto | null>(null);

/** Renders children only for signed-in users; otherwise redirects to /login?next=… */
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <div className="spinner" role="progressbar" aria-label="…" />;
  if (!me.data) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <UserCtx.Provider value={me.data}>{children}</UserCtx.Provider>;
}

export function useUser(): UserDto {
  const u = useContext(UserCtx);
  if (!u) throw new Error('useUser outside RequireAuth');
  return u;
}

/** Time zone used to display and enter dates (profile setting, else browser). */
export function useTz(): string {
  const u = useContext(UserCtx);
  return u?.timezone ?? browserTimeZone();
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    // Drop cached data of this user (memory + service-worker API cache).
    qc.clear();
    qc.setQueryData(keys.me, null);
    if ('caches' in window) await caches.delete('api').catch(() => undefined);
  };
}

/** Only allow same-app relative redirects (prevents open redirects). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
