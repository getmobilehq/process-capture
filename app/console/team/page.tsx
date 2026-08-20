import Link from 'next/link';
import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/console-auth';
import { ADMIN_COOKIE, identityFromSession } from '@/lib/auth';
import { listConsoleUsers } from '@/lib/db/queries';
import {
  addConsoleUserAction,
  deleteConsoleUserAction,
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
  self: 'You cannot disable or delete your own account.',
  nomatch: 'The email you typed did not match the account you were deleting. Nothing was removed.',
};

export default async function TeamPage({
  searchParams,
}: {
  searchParams: {
    error?: string;
    created?: string;
    password?: string;
    status?: string;
    deleted?: string;
    reviews?: string;
    remove?: string;
    check?: string;
    near?: string;
    name?: string;
  };
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

      {searchParams.deleted && (
        <div className="pc-card" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-5)' }}>
          <p className="t-body" style={{ margin: 0 }}>
            <b>{searchParams.deleted}</b> has been deleted and can no longer sign in.
            {Number(searchParams.reviews ?? '0') > 0
              ? ` Their ${searchParams.reviews} review${Number(searchParams.reviews) === 1 ? '' : 's'} keep their name — deleting the account does not rewrite what they approved.`
              : ' They had made no reviews.'}
          </p>
        </div>
      )}

      {searchParams.created && searchParams.password && (
        <div className="pc-card pc-newcred" style={{ marginTop: 'var(--space-5)' }}>
          <h2 className="t-h4" style={{ marginTop: 0 }}>
            Account created
          </h2>
          <p className="t-body-s" style={{ color: 'var(--fg-muted)', marginBottom: 4 }}>
            They sign in with both of these. Check the address is the one you meant — it is what
            they must type, exactly.
          </p>
          <p className="pc-newcred-label">Email</p>
          <p className="pc-newcred-value">{searchParams.created}</p>
          <p className="pc-newcred-label">Password</p>
          <p className="pc-newcred-value">{searchParams.password}</p>
          <p className="t-body-s" style={{ color: 'var(--fg-muted)', margin: 0 }}>
            Give both to them directly. The password is stored only as a hash, so this is the one
            time it can be shown — leaving this page loses it, and you would need to issue a new one.
          </p>
        </div>
      )}

      {named && searchParams.check && searchParams.near && (
        <div className="pc-card" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-5)', borderColor: 'var(--o2-blue)' }}>
          <h2 className="t-h4" style={{ marginTop: 0 }}>
            Is that address right?
          </h2>
          <p className="t-body-s">
            You entered <b>{searchParams.check}</b>. Other accounts here use{' '}
            <b>@{searchParams.near}</b>, and the two are close enough that this might be a slip —
            autofill often changes a field while you are looking at another one.
          </p>
          <p className="t-body-s" style={{ color: 'var(--fg-muted)' }}>
            If it is correct, carry on. If not, go back and change it — an account created at the
            wrong address simply will not let them sign in.
          </p>
          <form action={addConsoleUserAction} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <input type="hidden" name="email" value={searchParams.check} />
            <input type="hidden" name="name" value={searchParams.name ?? ''} />
            <input type="hidden" name="acknowledged" value={searchParams.check} />
            <label className="pc-field" style={{ margin: 0, minWidth: 220 }}>
              <span>Your own password</span>
              <input name="confirmPassword" type="password" required autoComplete="current-password" />
            </label>
            <button className="pc-btn" type="submit">
              Yes, create it
            </button>
            <Link href="/console/team" className="pc-btn ghost">
              Go back
            </Link>
          </form>
        </div>
      )}

      {named && searchParams.remove && (
        <div className="pc-card" style={{ padding: 'var(--space-5)', marginTop: 'var(--space-5)', borderColor: 'var(--vm-red)' }}>
          <h2 className="t-h4" style={{ marginTop: 0 }}>
            Delete {searchParams.remove}?
          </h2>
          <p className="t-body-s" style={{ color: 'var(--fg-muted)' }}>
            They will no longer be able to sign in. Anything they have already approved, edited or
            rejected keeps their name against it — deleting the account does not rewrite the record.
            There is no undo; if you only want to stop their access for now, disable them instead.
          </p>
          <form action={deleteConsoleUserAction} style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
            <input type="hidden" name="email" value={searchParams.remove} />
            <label className="pc-field" style={{ margin: 0 }}>
              <span>Type their email to confirm</span>
              <input name="confirmEmail" required placeholder={searchParams.remove} />
            </label>
            <label className="pc-field" style={{ margin: 0 }}>
              <span>Your own password</span>
              <input name="confirmPassword" type="password" required autoComplete="current-password" />
            </label>
            <span style={{ display: 'flex', gap: 8 }}>
              <button className="pc-btn danger" type="submit">
                Delete this account
              </button>
              <Link href="/console/team" className="pc-btn ghost">
                Cancel
              </Link>
            </span>
          </form>
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
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                        <Link href={`/console/team?remove=${encodeURIComponent(u.email)}`} className="pc-btn ghost sm danger-outline">
                          Delete
                        </Link>
                      </span>
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
