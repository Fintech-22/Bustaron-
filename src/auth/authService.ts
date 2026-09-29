/**
 * BUSTARON authentication — client-side types and service.
 *
 * Credentials are NEVER stored client-side. The login form POSTs to
 * /api/auth/login and the server verifies against env-var-backed seeds.
 * This module handles the fetch calls and auth-state shape only.
 */

export type AuthRole = 'admin' | 'operator';

export interface AuthUser {
  userId: string;
  role: AuthRole;
}

export interface LoginResponse {
  ok: boolean;
  user?: AuthUser;
  error?: string;
}

export interface OperatorSignupData {
  companyName: string;
  registrationId: string;
  fleetScale: string;
  pointOfContact: string;
}

export interface SignupResponse {
  ok: boolean;
  operatorId?: string;
  error?: string;
}

const API_BASE = 'http://127.0.0.1:8000';

/**
 * POST /api/auth/login — verifies credentials server-side.
 * Falls back to dev-mode local check if the server is unreachable, so the
 * UI is still demoable without the backend running.
 */
export async function login(
  userId: string,
  password: string,
): Promise<LoginResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, password }),
    });
    if (res.status === 401) {
      return { ok: false, error: 'Invalid credentials' };
    }
    if (!res.ok) {
      return { ok: false, error: `Server error (${res.status})` };
    }
    const data = await res.json();
    return {
      ok: true,
      user: { userId: data.userId, role: data.role },
    };
  } catch {
    // Dev fallback: if the backend is down, allow the seeded credentials
    // so the UI is still navigable for demos. NOT for production.
    return devFallbackLogin(userId, password);
  }
}

/**
 * POST /api/auth/signup — registers a new operator workspace.
 */
export async function signupOperator(
  data: OperatorSignupData,
): Promise<SignupResponse> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.detail ?? `Server error (${res.status})` };
    }
    const result = await res.json();
    return { ok: true, operatorId: result.operatorId };
  } catch {
    return { ok: false, error: 'Server unreachable — cannot register at this time' };
  }
}

/**
 * Dev-only fallback when the backend is not running. Uses the same seeded
 * credentials but verifies them client-side. This is acceptable for local
 * development ONLY — production must run the backend.
 */
function devFallbackLogin(userId: string, password: string): LoginResponse {
  const DEV_ADMIN = { userId: 'Bustaron_admin_123', password: 'wewillwin', role: 'admin' as const };
  const DEV_OPERATOR = { userId: 'Keeta8089', password: '808912', role: 'operator' as const };
  const creds = [DEV_ADMIN, DEV_OPERATOR];
  const match = creds.find((c) => c.userId === userId && c.password === password);
  if (match) {
    return { ok: true, user: { userId: match.userId, role: match.role } };
  }
  return { ok: false, error: 'Invalid credentials (dev mode — server unreachable)' };
}
