import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/console-auth';
import { config } from '@/lib/config';
import { getProject, listFindings } from '@/lib/db/queries';
import { buildRegister, buildConflicts } from '@/lib/console';
import { getFacet } from '@/lib/facets/facets';
import { CopyLink } from '@/components/console/CopyLink';
import { addIntervieweeAction, raiseConflictAction, updateFindingAction } from '../../actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Tab = 'register' | 'findings' | 'conflicts';

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  requireAdmin();
  const project = await getProject(params.id);
  if (!project) redirect('/console');

  const tab: Tab =
    searchParams.tab === 'findings' || searchParams.tab === 'conflicts'
      ? searchParams.tab
      : 'register';

  return (
    <main className="pc-wrap">
      <Link href="/console" className="t-body-s">
        ← All campaigns
      </Link>
      <h1 className="t-h2" style={{ marginTop: 'var(--space-3)' }}>
        {project.name}
      </h1>
      <p className="t-body" style={{ color: 'var(--fg-muted)' }}>
        {project.department}
        {project.description ? ` · ${project.description}` : ''}
      </p>

      <nav className="wrap tabs" style={{ display: 'flex', gap: 12, margin: 'var(--space-6) 0' }}>
        {(['register', 'findings', 'conflicts'] as Tab[]).map((t) => (
          <Link
            key={t}
            href={`/console/projects/${project.id}?tab=${t}`}
            className="pc-btn sm"
            style={
              t === tab
                ? {}
                : { background: 'var(--ink-25)', color: 'var(--ink-700)', border: '2px solid transparent' }
            }
          >
            {t === 'register' ? 'Register' : t === 'findings' ? 'Findings' : 'Candidate conflicts'}
          </Link>
        ))}
      </nav>

      {tab === 'register' && <Register projectId={project.id} targetProcesses={project.targetProcesses} />}
      {tab === 'findings' && <Findings projectId={project.id} />}
      {tab === 'conflicts' && <Conflicts projectId={project.id} />}
    </main>
  );
}

// ── Register (FR-1.4) ────────────────────────────────────────────────────────
async function Register({ projectId, targetProcesses }: { projectId: string; targetProcesses: string[] }) {
  const rows = await buildRegister(projectId);

  return (
    <>
      <div className="pc-card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
        <h2 className="t-h4" style={{ marginTop: 0 }}>
          Add an interviewee
        </h2>
        <form
          action={addIntervieweeAction}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 12, alignItems: 'end' }}
        >
          <input type="hidden" name="projectId" value={projectId} />
          <label className="pc-field" style={{ margin: 0 }}>
            <span>Name</span>
            <input name="fullName" required />
          </label>
          <label className="pc-field" style={{ margin: 0 }}>
            <span>Email</span>
            <input name="email" type="email" required />
          </label>
          <label className="pc-field" style={{ margin: 0 }}>
            <span>Role</span>
            <input name="role" required />
          </label>
          <button className="pc-btn" type="submit">
            Add &amp; issue link
          </button>
        </form>
        {targetProcesses.length > 0 && (
          <p className="t-caption" style={{ marginTop: 12 }}>
            Target processes: {targetProcesses.join(' · ')}
          </p>
        )}
      </div>

      <div className="pc-card" style={{ overflowX: 'auto' }}>
        <table className="regtable" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--ink-100)' }}>
              {['Interviewee', 'Role', 'Status', 'Coverage', 'Duration', 'Link / spec'].map((h) => (
                <th key={h} className="t-caption" style={{ padding: '12px 16px', color: 'var(--ink-500)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ interviewee, session, coverage, specVersion }) => {
              const resolved = coverage ? coverage.answered + coverage.unknown + coverage.not_applicable : 0;
              const pct = Math.round((resolved / 12) * 100);
              const statusClass =
                interviewee.status === 'complete' ? 'done' : interviewee.status === 'in_progress' ? 'prog' : 'inv';
              return (
                <tr key={interviewee.id} style={{ borderBottom: '1px solid var(--ink-50)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 600 }}>{interviewee.fullName}</td>
                  <td style={{ padding: '12px 16px' }}>{interviewee.role}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span className={`pc-pillst ${statusClass}`}>{interviewee.status.replace('_', ' ')}</span>
                  </td>
                  <td style={{ padding: '12px 16px', minWidth: 160 }}>
                    {coverage ? (
                      <div>
                        <div className="t-caption">
                          {coverage.answered} answered · {resolved}/12
                        </div>
                        <div className="pc-prog" style={{ marginTop: 4, width: 120 }}>
                          <i style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    ) : (
                      <span className="t-caption">—</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {session && session.durationSec > 0 ? `${Math.round(session.durationSec / 60)} min` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {specVersion && session ? (
                      <a className="pc-btn ghost sm" href={`/console/sessions/${session.id}`}>
                        Open spec v{specVersion}
                      </a>
                    ) : (
                      <CopyLink url={`${config.baseUrl}/i/${interviewee.inviteToken}`} />
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 'var(--space-6)', color: 'var(--fg-muted)' }}>
                  No interviewees yet. Add one above to issue a link.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Findings (FR-1.5) ────────────────────────────────────────────────────────
function Findings({ projectId }: { projectId: string }) {
  const findings = [...listFindings(projectId)].sort((a, b) => {
    const order = { open: 0, acknowledged: 1, resolved: 2 } as const;
    return order[a.status] - order[b.status];
  });

  if (findings.length === 0) {
    return (
      <div className="pc-card" style={{ padding: 'var(--space-6)' }}>
        <p className="t-body" style={{ color: 'var(--fg-muted)' }}>
          No findings raised yet.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {findings.map((f) => (
        <div key={f.id} className="pc-card" style={{ padding: 'var(--space-5)' }}>
          <div className="pc-finding" style={{ margin: 0 }}>
            <span className="tag">{f.type.replace(/_/g, ' ')}</span>
            <div style={{ fontWeight: 700, color: 'var(--ink-900)' }}>
              {f.facetId}. {getFacet(f.facetId).name} — {f.title}
            </div>
            {f.detail && <div style={{ marginTop: 4 }}>{f.detail}</div>}
          </div>
          <form
            action={updateFindingAction}
            style={{ display: 'flex', gap: 12, alignItems: 'end', marginTop: 12, flexWrap: 'wrap' }}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="findingId" value={f.id} />
            <label className="pc-field" style={{ margin: 0 }}>
              <span>Status</span>
              <select name="status" defaultValue={f.status}>
                <option value="open">open</option>
                <option value="acknowledged">acknowledged</option>
                <option value="resolved">resolved</option>
              </select>
            </label>
            <label className="pc-field" style={{ margin: 0, flex: 1, minWidth: 200 }}>
              <span>Routed to</span>
              <input name="routedTo" defaultValue={f.routedTo} placeholder="e.g. QA / compliance team" />
            </label>
            <button className="pc-btn sm" type="submit">
              Save
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}

// ── Candidate conflicts (FR-1.6) ─────────────────────────────────────────────
async function Conflicts({ projectId }: { projectId: string }) {
  const groups = await buildConflicts(projectId);

  if (groups.length === 0) {
    return (
      <div className="pc-card" style={{ padding: 'var(--space-6)' }}>
        <p className="t-body" style={{ color: 'var(--fg-muted)' }}>
          No candidate conflicts yet. These appear when two or more informants give a rule or metric
          for the same facet.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {groups.map((g) => (
        <div key={g.facetId} className="pc-card" style={{ padding: 'var(--space-5)' }} data-conflict-facet={g.facetId}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3 className="t-h4" style={{ margin: 0 }}>
              {g.facetId}. {g.facetName}
            </h3>
            {g.numericDiffer && (
              <span className="pc-pillst" style={{ background: 'var(--vmo2-pink-10)', color: 'var(--vmo2-pink)' }}>
                values differ
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            {g.entries.map((e) => (
              <div
                key={e.statementId}
                style={{ background: 'var(--ink-25)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}
              >
                <div className="t-caption" style={{ fontWeight: 700, color: 'var(--o2-blue)' }}>
                  {e.intervieweeName} · {e.role} · {e.kind}
                </div>
                <div className="t-body-s" style={{ marginTop: 4 }}>
                  {e.content}
                </div>
              </div>
            ))}
          </div>
          <form action={raiseConflictAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="facetId" value={g.facetId} />
            <input
              type="hidden"
              name="title"
              value={`Conflicting statements on ${g.facetName}`}
            />
            <input
              type="hidden"
              name="detail"
              value={g.entries.map((e) => `${e.intervieweeName}: ${e.content}`).join(' | ')}
            />
            <button className="pc-btn sm" type="submit">
              Raise as finding
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}
