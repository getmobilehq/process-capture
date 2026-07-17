import { adminEnabled } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const enabled = adminEnabled();

  return (
    <main className="pc-narrow">
      <span className="pc-secpill red">
        Process architect
        <i className="pc-cap" aria-hidden="true" />
      </span>
      <h1 className="t-h2" style={{ marginTop: 'var(--space-5)' }}>
        Console sign in.
      </h1>

      <div className="pc-card" style={{ marginTop: 'var(--space-6)', padding: 'var(--space-6)' }}>
        {!enabled ? (
          <p className="pc-privacy" style={{ margin: 0 }}>
            The console is not configured. Set <b>ADMIN_PASSWORD</b> in the environment to enable
            sign in.
          </p>
        ) : (
          <form action="/api/console/login" method="post">
            {searchParams.error === '1' && (
              <p className="t-caption" style={{ color: 'var(--vm-red)', marginBottom: 12 }} role="alert">
                That password was not recognised. Please try again.
              </p>
            )}
            {searchParams.error === 'rate' && (
              <p className="t-caption" style={{ color: 'var(--vm-red)', marginBottom: 12 }} role="alert">
                Too many attempts. Please wait a few minutes and try again.
              </p>
            )}
            <label className="pc-field">
              <span>Password</span>
              <input name="password" type="password" required autoFocus autoComplete="current-password" />
            </label>
            <button className="pc-btn" type="submit" style={{ marginTop: 'var(--space-2)' }}>
              Sign in
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
