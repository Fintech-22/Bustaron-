/**
 * Test auth helper — authenticates the store so tests that render <App />
 * can see the dashboard without going through the login page.
 *
 * Usage in beforeEach:
 *   import { authAdmin } from './authHelper';
 *   beforeEach(() => { authAdmin(); });
 *
 * For vi.resetModules() tests, use the async version:
 *   import { authAdminAsync } from './authHelper';
 *   beforeEach(async () => { await authAdminAsync(); });
 */
import { useDashboardStore } from '../store/dashboardStore';

export function authAdmin(): void {
  useDashboardStore.getState().authenticate({ userId: 'Bustaron_admin_123', role: 'admin' });
}

export function authOperator(): void {
  useDashboardStore.getState().authenticate({ userId: 'Keeta8089', role: 'operator' });
}

/** For tests that use vi.resetModules() — dynamically imports the store. */
export async function authAdminAsync(): Promise<void> {
  const mod = await import('../store/dashboardStore');
  mod.useDashboardStore.getState().authenticate({ userId: 'Bustaron_admin_123', role: 'admin' });
}
