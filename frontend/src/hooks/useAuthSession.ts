'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, logoutSession, ApiClientError } from '@/lib/api';
import {
  getToken,
  getRefreshToken,
  clearToken,
  getCachedSession,
  setCachedSession,
  AUTH_CHANGED_EVENT,
} from '@/lib/auth';
import { getRoleCapabilities, RoleCapabilities } from '@/lib/rbac';

export interface AuthSessionState {
  loading: boolean;
  token: string | null;
  role: string | null;
  user: { id: string; name: string; email?: string | null; phone?: string | null } | null;
  capabilities: RoleCapabilities;
  refresh: () => Promise<void>;
  signOut: () => void;
}

export function useAuthSession(opts: { redirectIfUnauth?: boolean } = {}): AuthSessionState {
  const router = useRouter();
  const redirectIfUnauth = opts.redirectIfUnauth ?? false;

  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [user, setUser] = useState<AuthSessionState['user']>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const sync = useCallback(async () => {
    const t = getToken();
    if (!t) {
      setToken(null);
      setRole(null);
      setUser(null);
      setLoading(false);
      if (redirectIfUnauth) {
        router.replace('/login');
      }
      return;
    }

    setToken(t);
    const cached = getCachedSession();
    if (cached) {
      setRole(cached.role);
      setUser(cached.user ?? null);
    }

    try {
      const me = await getMe(t);
      const latestToken = getToken();
      if (latestToken && latestToken !== t) {
        setToken(latestToken);
      }
      setRole(me.role);
      setUser(me.user);
      setCachedSession({ role: me.role, user: me.user }, true);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearToken();
        setToken(null);
        setRole(null);
        setUser(null);
        if (redirectIfUnauth) {
          router.replace('/login');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [redirectIfUnauth, router]);

  useEffect(() => {
    sync();
    const handler = () => {
      sync();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, [sync]);

  const signOut = useCallback(() => {
    const rt = getRefreshToken();
    if (rt) {
      logoutSession(rt).catch(() => {});
    }
    clearToken();
    setToken(null);
    setRole(null);
    setUser(null);
    router.push('/login');
  }, [router]);

  return {
    loading,
    token,
    role,
    user,
    capabilities: getRoleCapabilities(role),
    refresh: sync,
    signOut,
  };
}
