'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CoverageRail } from './CoverageRail';
import type { CoverageStateValue } from '@/lib/engine/coverage';

interface TurnView {
  seq: number;
  speaker: 'agent' | 'user' | 'system';
  content: string;
}
interface CoverageView {
  facetId: number;
  state: CoverageStateValue;
}

export interface InterviewRoomProps {
  sessionId: string;
  processName: string | null;
  initialTurns: TurnView[];
  initialCoverage: CoverageView[];
  initialStatus: 'open' | 'review' | 'complete' | 'abandoned';
  startedAtMs: number;
}

function fmt(elapsedSec: number): string {
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function InterviewRoom(props: InterviewRoomProps) {
  const [turns, setTurns] = useState<TurnView[]>(props.initialTurns);
  const [coverage, setCoverage] = useState<CoverageView[]>(props.initialCoverage);
  const [status, setStatus] = useState(props.initialStatus);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - props.startedAtMs) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [props.startedAtMs]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const nextSeq = useMemo(() => turns.reduce((m, t) => Math.max(m, t.seq), 0) + 1, [turns]);

  async function send() {
    const content = input.trim();
    if (!content || sending || status !== 'open') return;
    const seq = nextSeq;
    setError(null);
    setSending(true);
    setTurns((prev) => [...prev, { seq, speaker: 'user', content }]);
    setInput('');
    try {
      const res = await fetch(`/api/interview/${props.sessionId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seq, content }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Something went wrong');
      const result = await res.json();
      setTurns((prev) => [...prev, { seq: result.agentTurn.seq, speaker: 'agent', content: result.agentTurn.content }]);
      setCoverage(result.coverage);
      setStatus(result.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 'var(--space-8)', alignItems: 'start' }}>
      <section className="pc-card" style={{ display: 'flex', flexDirection: 'column', height: '78vh', overflow: 'hidden' }}>
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: '1px solid var(--ink-100)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="pc-avatar">PC</span>
            <div>
              <div className="t-body" style={{ fontWeight: 700 }}>
                {props.processName ?? 'A process you run'}
              </div>
              <div className="t-caption">Process capture assistant</div>
            </div>
          </div>
          <div className="pc-pillst prog" aria-label="Elapsed time" title="Time elapsed">
            ⏱ {fmt(elapsed)}
          </div>
        </header>

        <div ref={scrollRef} className="pc-chat" style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-5)' }}>
          {turns.map((t) => (
            <div key={`${t.seq}-${t.speaker}`} className={`pc-msg ${t.speaker}`}>
              {t.content}
            </div>
          ))}
          {sending && (
            <div className="pc-msg agent" aria-live="polite">
              …
            </div>
          )}
        </div>

        <footer style={{ borderTop: '1px solid var(--ink-100)', padding: 'var(--space-4) var(--space-5)' }}>
          {status === 'open' ? (
            <>
              {error && (
                <p className="t-caption" style={{ color: 'var(--vm-red)', marginBottom: 8 }} role="alert">
                  {error} — your message is saved; press send to retry.
                </p>
              )}
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <textarea
                  aria-label="Your reply"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={2}
                  placeholder="Type your reply…"
                  disabled={sending}
                  style={{
                    flex: 1,
                    resize: 'none',
                    font: '400 15px/1.4 var(--font-sans)',
                    border: '1.5px solid var(--ink-200)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                  }}
                />
                <button className="pc-btn" onClick={() => void send()} disabled={sending || !input.trim()}>
                  Send
                </button>
              </div>
            </>
          ) : (
            <p className="pc-privacy" style={{ margin: 0 }}>
              <b>Thank you.</b> Your interview is complete and has been shared with the process
              architecture team. You can close this window.
            </p>
          )}
        </footer>
      </section>

      <aside>
        <CoverageRail coverage={coverage} />
      </aside>
    </div>
  );
}
