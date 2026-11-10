// Client-side auth token, refresh token, cookie indicator & session cache helpers.
// Role/permissions are always refreshed authoritatively from GET /api/auth/me.

const TOKEN_KEY = 'bookcourier.token';
const REFRESH_KEY = 'bookcourier.refreshToken';
const SESSION_KEY = 'bookcourier.session';
const AUTH_COOKIE = 'bookcourier_auth';
export const AUTH_CHANGED_EVENT = 'bookcourier-auth-changed';

export interface CachedSession {
  role: string;
  user?: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    isEmailVerified?: boolean;
  } | null;
}

function notifyAuthChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
  }
}

function setAuthCookie(active: boolean) {
  if (typeof document === 'undefined') return;
  if (active) {
    document.cookie = `${AUTH_COOKIE}=1; path=/; max-age=604800; SameSite=Lax`;
  } else {
    document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setToken(token: string, session?: CachedSession, refreshToken?: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TOKEN_KEY, token);
  if (refreshToken) {
    window.localStorage.setItem(REFRESH_KEY, refreshToken);
  }
  if (session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }
  setAuthCookie(true);
  notifyAuthChange();
}

export function getCachedSession(): CachedSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedSession;
  } catch {
    return null;
  }
}

export function setCachedSession(session: CachedSession | null, silent = false) {
  if (typeof window === 'undefined') return;
  if (session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setAuthCookie(true);
  } else {
    window.localStorage.removeItem(SESSION_KEY);
  }
  if (!silent) {
    notifyAuthChange();
  }
}

export function clearToken() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem(SESSION_KEY);
  setAuthCookie(false);
  notifyAuthChange();
}

export function hasToken(): boolean {
  return getToken() !== null;
}
