import Link from 'next/link';
import { requireAdmin } from '@/lib/console-auth';
import { listProjects, listInterviewees } from '@/lib/db/queries';
import { createProjectAction } from './actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default function ConsoleHome() {
  requireAdmin();
  const projects = await listProjects();

  return (
    <main className="pc-wrap">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="pc-secpill purple">
          Process architect
          <i className="pc-cap" aria-hidden="true" />
        </span>
        <form action="/api/console/logout" method="post">
          <button className="pc-btn ghost sm" type="submit">
            Sign out
          </button>
        </form>
      </div>

      <h1 className="t-h2" style={{ marginTop: 'var(--space-5)' }}>
        Campaigns.
      </h1>
      <p className="t-body" style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-2)' }}>
        Each campaign is a department. Add the people who run the processes, issue their links, and
        watch the register fill.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 360px',
          gap: 'var(--space-8)',
          marginTop: 'var(--space-6)',
          alignItems: 'start',
        }}
      >
        <section>
          {projects.length === 0 ? (
            <div className="pc-card" style={{ padding: 'var(--space-6)' }}>
              <p className="t-body" style={{ color: 'var(--fg-muted)' }}>
                No campaigns yet. Create one to get started.
              </p>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 12 }}>
              {projects.map((p) => {
                const count = (await listInterviewees(p.id)).length;
                return (
                  <li key={p.id}>
                    <Link
                      href={`/console/projects/${p.id}`}
                      className="pc-card"
                      style={{ display: 'block', padding: 'var(--space-5)', textDecoration: 'none', color: 'inherit' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span className="t-h4">{p.name}</span>
                        <span className={`pc-pillst ${p.status === 'active' ? 'prog' : 'inv'}`}>{p.status}</span>
                      </div>
                      <div className="t-body-s" style={{ color: 'var(--fg-muted)', marginTop: 6 }}>
                        {p.department} · {count} {count === 1 ? 'interviewee' : 'interviewees'}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="pc-card" style={{ padding: 'var(--space-5)' }}>
          <h2 className="t-h4" style={{ marginTop: 0 }}>
            New campaign
          </h2>
          <form action={createProjectAction} style={{ marginTop: 'var(--space-3)' }}>
            <label className="pc-field">
              <span>Department name</span>
              <input name="name" required placeholder="Consumer operations" />
            </label>
            <label className="pc-field">
              <span>Department</span>
              <input name="department" required placeholder="Consumer operations" />
            </label>
            <label className="pc-field">
              <span>Description (optional)</span>
              <input name="description" placeholder="What this campaign is capturing" />
            </label>
            <label className="pc-field">
              <span>Target processes (optional, one per line)</span>
              <textarea
                name="targetProcesses"
                rows={3}
                placeholder={'Billing complaint resolution\nGoodwill credit approval'}
                style={{
                  width: '100%',
                  font: '400 15px/1.4 var(--font-sans)',
                  border: '1.5px solid var(--ink-200)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 14px',
                  resize: 'vertical',
                }}
              />
            </label>
            <button className="pc-btn" type="submit" style={{ marginTop: 'var(--space-2)' }}>
              Create campaign
            </button>
          </form>
        </aside>
      </div>
    </main>
  );
}
