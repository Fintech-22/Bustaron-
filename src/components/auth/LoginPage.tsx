import { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { login, signupOperator } from '../../auth/authService';
import type { OperatorSignupData } from '../../auth/authService';

type Mode = 'signin' | 'signup';

/**
 * PRD §7: authentication entry point.
 *
 * Two modes:
 *  — Sign In: userId + password verified server-side via POST /api/auth/login.
 *  — Sign Up as Operator: Company Name, Registration ID, Fleet Scale, Point of
 *    Contact filed via POST /api/auth/signup.
 *
 * The login page is the first thing an unauthenticated user sees. After a
 * successful sign-in the store's `authenticate()` sets the session and the
 * AppShell renders the dashboard.
 */
export function LoginPage(): JSX.Element {
  const authenticate = useDashboardStore((state) => state.authenticate);
  const [mode, setMode] = useState<Mode>('signin');

  // ── sign-in state ──────────────────────────────────────────────────
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  // ── sign-up state ──────────────────────────────────────────────────
  const [companyName, setCompanyName] = useState('');
  const [registrationId, setRegistrationId] = useState('');
  const [fleetScale, setFleetScale] = useState('');
  const [pointOfContact, setPointOfContact] = useState('');
  const [signUpError, setSignUpError] = useState<string | null>(null);
  const [signUpSuccess, setSignUpSuccess] = useState<string | null>(null);
  const [signingUp, setSigningUp] = useState(false);

  async function handleSignIn(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!userId.trim() || !password.trim()) {
      setSignInError('User ID and password are required');
      return;
    }
    setSigningIn(true);
    setSignInError(null);
    const result = await login(userId.trim(), password);
    setSigningIn(false);
    if (result.ok && result.user) {
      authenticate(result.user);
    } else {
      setSignInError(result.error ?? 'Login failed');
    }
  }

  async function handleSignUp(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const data: OperatorSignupData = {
      companyName: companyName.trim(),
      registrationId: registrationId.trim(),
      fleetScale: fleetScale.trim(),
      pointOfContact: pointOfContact.trim(),
    };
    if (!data.companyName || !data.registrationId || !data.fleetScale || !data.pointOfContact) {
      setSignUpError('All fields are required');
      return;
    }
    setSigningUp(true);
    setSignUpError(null);
    setSignUpSuccess(null);
    const result = await signupOperator(data);
    setSigningUp(false);
    if (result.ok) {
      setSignUpSuccess(
        `Workspace registered successfully. Your operator ID is ${result.operatorId}. ` +
          'Use the seeded operator credentials (Keeta8089 / 808912) to sign in.',
      );
      setCompanyName('');
      setRegistrationId('');
      setFleetScale('');
      setPointOfContact('');
    } else {
      setSignUpError(result.error ?? 'Registration failed');
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark brand-mark--large" aria-hidden="true">B</div>
          <div>
            <h1 className="login-title">BUSTARON</h1>
            <p className="login-subtitle">Hong Kong Drone Airspace Management</p>
          </div>
        </div>

        <div className="login-tabs" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            className={`login-tab ${mode === 'signin' ? 'login-tab--active' : ''}`}
            onClick={(): void => setMode('signin')}
          >
            Sign In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signup'}
            className={`login-tab ${mode === 'signup' ? 'login-tab--active' : ''}`}
            onClick={(): void => setMode('signup')}
          >
            Sign Up as Operator
          </button>
        </div>

        {mode === 'signin' && (
          <form className="login-form" onSubmit={handleSignIn}>
            <div className="form-field">
              <label htmlFor="login-user-id" className="form-label">User ID</label>
              <input
                id="login-user-id"
                type="text"
                className="form-input"
                value={userId}
                onChange={(e): void => setUserId(e.target.value)}
                autoComplete="username"
                placeholder="Enter your user ID"
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="login-password" className="form-label">Password</label>
              <input
                id="login-password"
                type="password"
                className="form-input"
                value={password}
                onChange={(e): void => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
            </div>
            {signInError && <p className="form-error" role="alert">{signInError}</p>}
            <button
              type="submit"
              className="login-submit"
              disabled={signingIn}
            >
              {signingIn ? 'Signing in…' : 'Sign In'}
            </button>
            <p className="form-hint">
              Admin: Bustaron_admin_123 · Operator: Keeta8089
            </p>
          </form>
        )}

        {mode === 'signup' && (
          <form className="login-form" onSubmit={handleSignUp}>
            <div className="form-field">
              <label htmlFor="signup-company" className="form-label">Company Name</label>
              <input
                id="signup-company"
                type="text"
                className="form-input"
                value={companyName}
                onChange={(e): void => setCompanyName(e.target.value)}
                placeholder="Registered company name"
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="signup-reg" className="form-label">Registration ID</label>
              <input
                id="signup-reg"
                type="text"
                className="form-input"
                value={registrationId}
                onChange={(e): void => setRegistrationId(e.target.value)}
                placeholder="CAD/CAC registration ID"
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="signup-fleet" className="form-label">Fleet Scale</label>
              <select
                id="signup-fleet"
                className="form-input"
                value={fleetScale}
                onChange={(e): void => setFleetScale(e.target.value)}
                required
              >
                <option value="">Select fleet size…</option>
                <option value="1-5">1–5 drones</option>
                <option value="6-20">6–20 drones</option>
                <option value="21-50">21–50 drones</option>
                <option value="50+">50+ drones</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="signup-contact" className="form-label">Point of Contact</label>
              <input
                id="signup-contact"
                type="text"
                className="form-input"
                value={pointOfContact}
                onChange={(e): void => setPointOfContact(e.target.value)}
                placeholder="Name / phone / email"
                required
              />
            </div>
            {signUpError && <p className="form-error" role="alert">{signUpError}</p>}
            {signUpSuccess && <p className="form-success" role="status">{signUpSuccess}</p>}
            <button
              type="submit"
              className="login-submit"
              disabled={signingUp}
            >
              {signingUp ? 'Registering…' : 'Register Workspace'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
