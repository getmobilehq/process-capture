export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--space-16) var(--space-6)' }}>
      <p className="t-eyebrow" style={{ color: 'var(--brand-accent)' }}>
        Virgin Media O2
      </p>
      <h1 className="t-h1" style={{ marginTop: 'var(--space-3)' }}>
        Process capture.
      </h1>
      <p className="t-body-l" style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-4)' }}>
        This tool captures how a process really works, in the words of the people who run it. If
        you have been sent a link, open it to begin your interview. Process architects can sign in
        to the console.
      </p>
      <p className="t-body" style={{ marginTop: 'var(--space-8)' }}>
        <a href="/console">Go to the console →</a>
      </p>
    </main>
  );
}
