export function DeadEnd({ kind }: { kind: 'invalid' | 'used_up' }) {
  const title = kind === 'used_up' ? 'This interview is complete.' : 'We don’t recognise this link.';
  const body =
    kind === 'used_up'
      ? 'Thanks — your interview has already been submitted. There’s nothing more to do here. If you think this is a mistake, please get back in touch with whoever sent you the link.'
      : 'This link may be mistyped, or it may have expired. Please check the link you were sent, or ask whoever sent it to issue a new one.';

  return (
    <div className="pc-deadend">
      <span className="pc-secpill blue">
        Process capture
        <i className="pc-cap" aria-hidden="true" />
      </span>
      <h1 className="t-h3" style={{ marginTop: 'var(--space-6)' }}>
        {title}
      </h1>
      <p className="t-body" style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-3)' }}>
        {body}
      </p>
    </div>
  );
}
