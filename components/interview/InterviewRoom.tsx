'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  /** Unsubmitted draft recovered from the server, if the tab went away (R10.3). */
  initialDraft: { content: string; seq: number; take: number } | null;
  /** The felt horizon (R9.1) — the interview has an end the informant can see. */
  initialBudget: { asked: number; globalCap: number; remaining: number; exhausted: boolean };
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
  const [input, setInput] = useState(props.initialDraft?.content ?? '');
  const [sending, setSending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [survey, setSurvey] = useState(props.surveyUrl);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  // R10.3 — draft protection.
  const [recovered, setRecovered] = useState(Boolean(props.initialDraft?.content));
  const [canUndo, setCanUndo] = useState(false);
  const [budget, setBudget] = useState(props.initialBudget);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmRerecord, setConfirmRerecord] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const originRef = useRef<'typed' | 'voice' | 'mixed'>('typed');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (finishing || (status !== 'review' && status !== 'open')) return;
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

  // ── R10.3 — continuous autosave, recovery, and reversible destruction ──────

  /** Persist the draft. Debounced on keystrokes, immediate on state changes. */
  const persistDraft = useCallback(
    async (content: string, origin: 'typed' | 'voice' | 'mixed') => {
      try {
        const res = await fetch(`/api/interview/${props.sessionId}/draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'save', seq: nextSeq, content, origin }),
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          setCanUndo(Boolean(data.canUndo));
          setSavedAt(Date.now());
        }
      } catch {
        // Autosave is best-effort per keystroke; the beforeunload guard and the
        // next successful save cover a transient failure.
      }
    },
    [props.sessionId, nextSeq],
  );

  // Every few keystrokes, and at most ~1.2s behind the typing (R10.3).
  useEffect(() => {
    if (status !== 'open' && status !== 'review') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persistDraft(input, originRef.current), 1200);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [input, persistDraft, status]);

  // Leaving with an unsubmitted draft warns, and the draft is saved either way.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (input.trim() === '') return;
      void persistDraft(input, originRef.current);
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [input, persistDraft]);

  /** Elapsed recording time — the informant always knows they are being captured. */
  useEffect(() => {
    if (!recording || paused) return;
    const id = setInterval(() => setRecordSec((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [recording, paused]);

  async function draftAction(action: 'discard' | 'undo' | 'rerecord') {
    setError(null);
    try {
      const res = await fetch(`/api/interview/${props.sessionId}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, seq: nextSeq }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? 'That did not work.');
      setInput(data.draft?.content ?? '');
      setCanUndo(Boolean(data.canUndo));
      setRecovered(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
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
      if (text) {
        originRef.current = originRef.current === 'typed' ? 'voice' : 'mixed';
        setInput((prev) => {
          const next = prev.trim() ? `${prev.trim()} ${text}` : text;
          void persistDraft(next, originRef.current);
          return next;
        });
      }
      else setError('Nothing was picked up — please try again or type your reply.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not transcribe that — please type your reply.');
    } finally {
      setTranscribing(false);
    }
  }

  function togglePause() {
    const rec = recorderRef.current;
    if (!rec || !recording) return;
    if (paused) {
      rec.resume();
      setPaused(false);
    } else {
      rec.pause();
      setPaused(true);
    }
  }

  async function toggleRecord() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (transcribing || sending) return;
    setRecordSec(0);
    setPaused(false);
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
        setPaused(false);
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
      originRef.current = 'typed';
      setSavedAt(null);
      if (result.budget) setBudget(result.budget);
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
              <div className="t-caption">Magpie assistant</div>
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
              {recovered && (
                <div className="pc-recovery" role="status">
                  <b>You have an unsubmitted answer.</b> We saved what you had written
                  when this page last closed — carry on where you left off, or clear it.
                  <button type="button" className="pc-check-na" onClick={() => setRecovered(false)}>
                    Got it
                  </button>
                </div>
              )}

              {recording && (
                <div className={`pc-reclive ${paused ? 'paused' : ''}`} role="status">
                  <span className="pc-recdot" aria-hidden="true" />
                  <span className="pc-recstate">{paused ? 'Paused' : 'Recording'}</span>
                  <span className="pc-rectime">{fmt(recordSec)}</span>
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
                  <>
                    {/* R10.1 — icon plus word, never icon-only, and unmistakable. */}
                    <button
                      type="button"
                      className={`pc-rec ${recording ? 'stop' : ''}`}
                      onClick={() => void toggleRecord()}
                      disabled={sending || transcribing}
                    >
                      <span className="pc-rec-ico" aria-hidden="true">
                        {transcribing ? '…' : recording ? '■' : '●'}
                      </span>
                      {transcribing ? 'Transcribing' : recording ? 'Stop' : 'Record'}
                    </button>
                    {recording && (
                      <button type="button" className="pc-btn ghost sm" onClick={togglePause}>
                        {paused ? 'Resume' : 'Pause'}
                      </button>
                    )}
                  </>
                )}
                <button className="pc-btn" onClick={() => void send()} disabled={sending || !input.trim()}>
                  {sending ? 'Sending…' : 'Submit answer'}
                </button>
              </div>

              {/* Destructive actions live here — never adjacent to Submit (R10.3). */}
              <div className="pc-draftbar">
                <span className="pc-savedstate">
                  {status === 'open' && (
                    <span className="pc-budget">
                      Question {Math.min(budget.asked, budget.globalCap)} of ~{budget.globalCap}
                    </span>
                  )}
                  {savedAt ? ' · Saved' : input.trim() ? ' · Saving…' : ''}
                </span>
                {status === 'open' && (
                  <button
                    type="button"
                    className="pc-check-na"
                    onClick={() => setConfirmFinish(true)}
                  >
                    Finish recording
                  </button>
                )}
                {canUndo && (
                  <button type="button" className="pc-check-na" onClick={() => void draftAction('undo')}>
                    Undo discard
                  </button>
                )}
                {props.voiceEnabled && input.trim() !== '' && !recording && (
                  <button
                    type="button"
                    className="pc-check-na"
                    onClick={() => setConfirmRerecord(true)}
                  >
                    Re-record
                  </button>
                )}
                {input.trim() !== '' && (
                  <button
                    type="button"
                    className="pc-check-na danger"
                    onClick={() => setConfirmDiscard(true)}
                  >
                    Discard
                  </button>
                )}
              </div>

              {confirmFinish && (
                <div className="pc-confirm" role="alertdialog">
                  <b>Finish here?</b> We will write up everything you have told us. Anything
                  we did not get to is noted as still open — that is normal, and someone can
                  pick it up later.
                  <span className="pc-confirm-acts">
                    <button
                      type="button"
                      className="pc-btn ghost sm"
                      onClick={() => setConfirmFinish(false)}
                    >
                      Keep going
                    </button>
                    <button
                      type="button"
                      className="pc-btn sm"
                      disabled={finishing}
                      onClick={() => {
                        setConfirmFinish(false);
                        void finish();
                      }}
                    >
                      {finishing ? 'Finishing…' : 'Finish and write it up'}
                    </button>
                  </span>
                </div>
              )}

              {confirmDiscard && (
                <div className="pc-confirm" role="alertdialog">
                  <b>Discard {input.trim().split(/\s+/).length} words?</b> You can bring
                  it back with Undo for the rest of this interview.
                  <span className="pc-confirm-acts">
                    <button
                      type="button"
                      className="pc-btn ghost sm"
                      onClick={() => setConfirmDiscard(false)}
                    >
                      Keep it
                    </button>
                    <button
                      type="button"
                      className="pc-btn sm danger"
                      onClick={() => {
                        setConfirmDiscard(false);
                        void draftAction('discard');
                      }}
                    >
                      Discard
                    </button>
                  </span>
                </div>
              )}

              {confirmRerecord && (
                <div className="pc-confirm" role="alertdialog">
                  <b>Start again?</b> We keep this take until you submit the new one,
                  so nothing is lost.
                  <span className="pc-confirm-acts">
                    <button
                      type="button"
                      className="pc-btn ghost sm"
                      onClick={() => setConfirmRerecord(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="pc-btn sm"
                      onClick={() => {
                        setConfirmRerecord(false);
                        void draftAction('rerecord');
                      }}
                    >
                      Re-record
                    </button>
                  </span>
                </div>
              )}
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
