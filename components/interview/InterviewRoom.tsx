'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CoverageRail, type ElementRow } from './CoverageRail';
import { PickList, type PickOption } from './PickList';
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
  initialElements: ElementRow[];
  initialOptions: Record<number, PickOption[]>;
  initialStatus: 'open' | 'review' | 'complete' | 'abandoned';
  startedAtMs: number;
  surveyUrl: string;
  voiceEnabled: boolean;
}

/** Plain-language headings for the pick-list facets — never the facet name. */
const PICKLIST_TITLES = [
  { facetId: 2, title: 'Who else is involved? Tap any that apply.' },
  { facetId: 3, title: 'What sets this off? Tap any that apply.' },
  { facetId: 4, title: 'What goes in and comes out? Tap any that apply.' },
  { facetId: 8, title: 'Which of these do you use? Tap any that apply.' },
] as const;

function fmt(elapsedSec: number): string {
  const m = Math.floor(elapsedSec / 60);
  const s = elapsedSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function InterviewRoom(props: InterviewRoomProps) {
  const [turns, setTurns] = useState<TurnView[]>(props.initialTurns);
  const [coverage, setCoverage] = useState<CoverageView[]>(props.initialCoverage);
  const [elements, setElements] = useState<ElementRow[]>(props.initialElements);
  const [options, setOptions] = useState<Record<number, PickOption[]>>(props.initialOptions);
  const [picking, setPicking] = useState(false);
  const [status, setStatus] = useState(props.initialStatus);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [survey, setSurvey] = useState(props.surveyUrl);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

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

  /**
   * The pick-list to offer alongside the composer: the pick-list facet the
   * interview is currently working on. Only one at a time — the tick-list assists
   * the conversation, it does not become a form to fill in (R2.1).
   */
  const activePick = useMemo(() => {
    if (status !== 'open') return null;
    const inProgress = PICKLIST_TITLES.find(
      (p) => coverage.find((c) => c.facetId === p.facetId)?.state === 'partial',
    );
    const next =
      inProgress ??
      PICKLIST_TITLES.find(
        (p) => coverage.find((c) => c.facetId === p.facetId)?.state === 'pending',
      );
    if (!next) return null;
    return (options[next.facetId] ?? []).length > 0 ? next : null;
  }, [coverage, options, status]);

  async function finish() {
    if (finishing || status !== 'review') return;
    setError(null);
    setFinishing(true);
    try {
      const res = await fetch(`/api/interview/${props.sessionId}/confirm`, { method: 'POST' });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result?.error ?? 'We could not finalise your interview.');
      setStatus('complete');
      if (result.surveyUrl) setSurvey(result.surveyUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not finalise your interview.');
    } finally {
      setFinishing(false);
    }
  }

  /**
   * The interviewee rules an element out themselves (R1.3). The reason is part of
   * the record — an unexplained N/A is a silent gap by another name — so an empty
   * reason cancels rather than closing the element.
   */
  async function markNotApplicable(elementId: string, reason: string) {
    if (reason.trim() === '') return;

    setError(null);
    try {
      const res = await fetch(`/api/interview/${props.sessionId}/element`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elementId, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Could not update that.');
      if (data.elements) setElements(data.elements);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that.');
    }
  }

  /**
   * Tick a pick-list option, or describe one that is not on the list (R2.1).
   * Selections write canonical entity ids, never free text (R2.3).
   */
  async function recordEntity(facetId: number, payload: { entityId?: string; name?: string }) {
    setPicking(true);
    setError(null);
    try {
      const res = await fetch(`/api/interview/${props.sessionId}/entity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facetId, ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Could not record that.');
      if (data.options) setOptions((prev) => ({ ...prev, [facetId]: data.options }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that.');
    } finally {
      setPicking(false);
    }
  }

  async function transcribe(blob: Blob) {
    setTranscribing(true);
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'reply.webm');
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'Could not transcribe that.');
      const text = String(data.text ?? '').trim();
      if (text) setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
      else setError('Nothing was picked up — please try again or type your reply.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not transcribe that — please type your reply.');
    } finally {
      setTranscribing(false);
    }
  }

  async function toggleRecord() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (transcribing || sending) return;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size > 0) void transcribe(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError('Microphone access was blocked. You can still type your reply.');
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || sending || (status !== 'open' && status !== 'review')) return;
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
      if (result.elements) setElements(result.elements);
      setStatus(result.status);
    } catch (err) {
      // Roll back the optimistic bubble and restore the text so the user can
      // resend at the same seq (the server dedupes, so a retry is idempotent).
      setTurns((prev) => prev.filter((t) => !(t.seq === seq && t.speaker === 'user')));
      setInput(content);
      setError(err instanceof Error ? err.message : 'Something went wrong. Please send that again.');
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
          {error && (
            <p className="t-caption" style={{ color: 'var(--vm-red)', marginBottom: 8 }} role="alert">
              {error}
            </p>
          )}

          {status === 'complete' ? (
            <p className="pc-privacy" style={{ margin: 0 }}>
              <b>Thank you.</b> Your interview is complete and has been shared with the process
              architecture team. You can close this window.
              {survey && (
                <>
                  {' '}
                  If you have a moment,{' '}
                  <a href={survey} target="_blank" rel="noreferrer">
                    tell us how it went
                  </a>
                  .
                </>
              )}
            </p>
          ) : (
            <>
              {status === 'review' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <span className="t-body-s" style={{ color: 'var(--fg-muted)' }}>
                    If that all looks right, you&rsquo;re done. Otherwise, tell me what to change.
                  </span>
                  <button
                    className="pc-btn sm"
                    onClick={() => void finish()}
                    disabled={finishing}
                    style={{ marginLeft: 'auto' }}
                  >
                    {finishing ? 'Finishing…' : 'Yes, that’s right — finish'}
                  </button>
                </div>
              )}
              {activePick && (
                <PickList
                  title={activePick.title}
                  options={options[activePick.facetId] ?? []}
                  busy={picking || sending}
                  onSelect={(entityId) => void recordEntity(activePick.facetId, { entityId })}
                  onDescribe={(name) => void recordEntity(activePick.facetId, { name })}
                />
              )}
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <textarea
                  aria-label="Your reply"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={2}
                  placeholder={
                    recording
                      ? 'Listening… tap the mic to stop'
                      : transcribing
                        ? 'Transcribing…'
                        : status === 'review'
                          ? 'Add a correction…'
                          : 'Type your reply…'
                  }
                  disabled={sending}
                  style={{
                    flex: 1,
                    resize: 'none',
                    font: '400 15px/1.4 var(--font-sans)',
                    border: `1.5px solid ${recording ? 'var(--vm-red)' : 'var(--ink-200)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                  }}
                />
                {props.voiceEnabled && (
                  <button
                    type="button"
                    aria-label={recording ? 'Stop recording' : 'Record voice answer'}
                    title={recording ? 'Stop recording' : 'Record voice answer'}
                    onClick={() => void toggleRecord()}
                    disabled={sending || transcribing}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      border: `2px solid ${recording ? 'var(--vm-red)' : 'var(--o2-blue)'}`,
                      background: recording ? 'var(--vm-red)' : '#fff',
                      color: recording ? '#fff' : 'var(--o2-blue)',
                      cursor: sending || transcribing ? 'not-allowed' : 'pointer',
                      fontSize: 18,
                      flexShrink: 0,
                    }}
                  >
                    {transcribing ? '…' : recording ? '■' : '🎤'}
                  </button>
                )}
                <button className="pc-btn ghost" onClick={() => void send()} disabled={sending || !input.trim()}>
                  Send
                </button>
              </div>
            </>
          )}
        </footer>
      </section>

      <aside>
        <CoverageRail
          coverage={coverage}
          elements={elements}
          onMarkNotApplicable={markNotApplicable}
        />
      </aside>
    </div>
  );
}
