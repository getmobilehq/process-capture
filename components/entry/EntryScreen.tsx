import { startInterview } from '@/app/i/[token]/actions';

export interface EntryScreenProps {
  token: string;
  fullName: string;
  email: string;
  role: string;
  department: string;
  targetProcesses: string[];
  retentionDays: number;
  resuming: boolean;
}

/**
 * Interview entry screen (FR-2.1): privacy notice, prefilled editable identity,
 * optional process picker (FR-2.3), start button. Server component — the form
 * posts to the `startInterview` server action.
 */
export function EntryScreen(props: EntryScreenProps) {
  const { token, fullName, email, role, department, targetProcesses, retentionDays, resuming } =
    props;

  return (
    <div className="pc-narrow">
      <span className="pc-secpill pink">
        Process capture
        <i className="pc-cap" aria-hidden="true" />
      </span>

      <h1 className="t-h2" style={{ marginTop: 'var(--space-5)' }}>
        {resuming ? 'Welcome back.' : 'Before you start.'}
      </h1>
      <p className="t-body" style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-2)' }}>
        {resuming
          ? 'You have an interview in progress. Check your details and pick up where you left off.'
          : `A short conversation about a process you run in ${department}, for the process architecture team.`}
      </p>

      <div className="pc-card" style={{ marginTop: 'var(--space-6)', padding: 'var(--space-6)' }}>
        <p className="pc-privacy">
          <b>Before you start.</b> We&rsquo;ll record your name, role and what you tell us about your
          own work, to build a process specification for your department. No screen recording, no
          monitoring &ndash; just this conversation. Your answers are attributed to you and shared
          with the process architecture team. Data is retained for {retentionDays} days and you can
          ask for it to be removed at any time. Please describe colleagues by role rather than name.
        </p>

        <form action={startInterview} style={{ marginTop: 'var(--space-5)' }}>
          <input type="hidden" name="token" value={token} />

          <label className="pc-field">
            <span>Your name</span>
            <input name="fullName" defaultValue={fullName} required autoComplete="name" />
          </label>

          <label className="pc-field">
            <span>Email</span>
            <input
              name="email"
              type="email"
              defaultValue={email}
              required
              autoComplete="email"
            />
          </label>

          <label className="pc-field">
            <span>Your role</span>
            <input name="role" defaultValue={role} required autoComplete="organization-title" />
          </label>

          {targetProcesses.length > 0 && (
            <label className="pc-field">
              <span>Which process are we talking about?</span>
              <select name="processName" defaultValue={targetProcesses[0]}>
                {targetProcesses.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value="__something_else__">Something else</option>
              </select>
            </label>
          )}

          <button className="pc-btn" type="submit" style={{ marginTop: 'var(--space-4)' }}>
            {resuming ? 'Resume interview' : 'Start interview'}
            <span aria-hidden="true">→</span>
          </button>
        </form>
      </div>
    </div>
  );
}
