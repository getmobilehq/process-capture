import Link from 'next/link';
import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/console-auth';
import { ADMIN_COOKIE, identityFromSession } from '@/lib/auth';
import { listConsoleUsers } from '@/lib/db/queries';
import {
  addConsoleUserAction,
  resetConsoleUserAction,
  setConsoleUserStatusAction,
} from '../team-actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ERRORS: Record<string, string> = {
  shared: 'You are signed in with the shared password. Sign in with your own account to manage people — an account that nobody is named in should not be creating ones that are.',
  confirm: 'That password was not recognised. Confirming it is what stops a stolen session creating access that outlives it.',
  exists: 'Someone already has an account with that email. Use “New password” instead.',
  missing: 'A name and email are both needed.',
  self: 'You cannot disable your own account.',
};

export default async function TeamPage({
  searchParams,
}: {
  searchParams: { error?: string; created?: string; password?: string; status?: string };
}) {
  requireAdmin();
  const identity = await identityFromSession(cookies().get(ADMIN_COOKIE)?.value);
  const users = await listConsoleUsers();
  const named = Boolean(identity?.userId);

  return (
    <main className="pc-wrap">
      <Link href="/console" className="t-body-s">
        ← All campaigns
      </Link>
      <h1 className="t-h2" style={{ marginTop: 'var(--space-3)' }}>
        People.
      </h1>
      <p className="t-body" style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-2)' }}>
        Anyone here can run interviews and review analysis. Every review they approve, edit or
        reject is recorded against their name — so give people their own account before they start
        reviewing, not after.
      </p>

      {searchParams.error && (
        <div className="pc-card" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-5)', borderColor: 'var(--vm-red)' }}>
          <p className="t-body" style={{ margin: 0, color: 'var(--vm-red)' }}>
            {ERRORS[searchParams.error] ?? 'That did not work.'}
          </p>
        </div>
      )}

      {searchParams.created && searchParams.password && (
        <div className="pc-card pc-newcred" style={{ marginTop: 'var(--space-5)' }}>
          <h2 className="t-h4" style={{ marginTop: 0 }}>
            Password for {searchParams.created}
          </h2>
          <p className="pc-newcred-value">{searchParams.password}</p>
          <p className="t-body-s" style={{ color: 'var(--fg-muted)', margin: 0 }}>
            Give this to them directly and ask them to keep it in a password manager. It is stored
            only as a hash, so this is the one time it can be shown. Leaving this page loses it —
            issue a new one if that happens.
          </p>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 360px',
          gap: 'var(--space-8)',
          marginTop: 'var(--space-6)',
          alignItems: 'start',
        }}
      >
        <section className="pc-card" style={{ overflowX: 'auto' }}>
          <table className="regtable" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--ink-100)' }}>
                {['Name', 'Email', 'Status', 'Last signed in', ''].map((h) => (
                  <th key={h} className="t-caption" style={{ padding: '12px 16px', color: 'var(--ink-500)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--ink-50)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{u.name}</td>
                  <td style={{ padding: '12px 16px' }}>{u.email}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span className={`pc-pillst ${u.status === 'active' ? 'done' : 'inv'}`}>{u.status}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }} className="t-caption">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('en-GB') : 'never'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {named && u.id !== identity?.userId && (
                      <form action={setConsoleUserStatusAction} style={{ display: 'inline' }}>
                        <input type="hidden" name="email" value={u.email} />
                        <input
                          type="hidden"
                          name="status"
                          value={u.status === 'active' ? 'disabled' : 'active'}
                        />
                        <button className="pc-btn ghost sm" type="submit">
                          {u.status === 'active' ? 'Disable' : 'Enable'}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 'var(--space-6)', color: 'var(--fg-muted)' }}>
                    No accounts yet — everyone is signing in with the shared password, so every
                    review reads “console admin”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <aside className="pc-card" style={{ padding: 'var(--space-5)' }}>
          <h2 className="t-h4" style={{ marginTop: 0 }}>
            Add someone
          </h2>
          {!named ? (
            <p className="t-body-s" style={{ color: 'var(--fg-muted)' }}>
              You are signed in with the shared password. Sign in with your own account to add
              people — an account that nobody is named in should not be creating ones that are.
            </p>
          ) : (
            <form action={addConsoleUserAction} style={{ marginTop: 'var(--space-3)' }}>
              <label className="pc-field">
                <span>Full name</span>
                <input name="name" required placeholder="Priya Nair" />
              </label>
              <label className="pc-field">
                <span>Email</span>
                <input name="email" type="email" required placeholder="priya.nair@virginmediao2.co.uk" />
              </label>
              <label className="pc-field">
                <span>Your own password</span>
                <input
                  name="confirmPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </label>
              <p className="t-caption" style={{ color: 'var(--fg-muted)', marginTop: 4 }}>
                Confirming who you are is what stops a stolen session creating access that outlives
                it.
              </p>
              <button className="pc-btn" type="submit" style={{ marginTop: 'var(--space-3)' }}>
                Create account
              </button>
            </form>
          )}

          {named && users.length > 0 && (
            <>
              <h2 className="t-h4" style={{ marginTop: 'var(--space-6)' }}>
                New password
              </h2>
              <form action={resetConsoleUserAction}>
                <label className="pc-field">
                  <span>Their email</span>
                  <input name="email" type="email" required />
                </label>
                <label className="pc-field">
                  <span>Your own password</span>
                  <input name="confirmPassword" type="password" required autoComplete="current-password" />
                </label>
                <button className="pc-btn ghost sm" type="submit" style={{ marginTop: 'var(--space-2)' }}>
                  Issue a new password
                </button>
              </form>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
