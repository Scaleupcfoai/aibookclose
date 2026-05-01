import { useEffect, useState } from 'react';
import Upload from './components/Upload.jsx';
import AgentStream from './components/AgentStream.jsx';
import FlagReview from './components/FlagReview.jsx';
import ProposalReview from './components/ProposalReview.jsx';
import TDSReport from './components/TDSReport.jsx';
import { apiFetch, apiJson } from './lib/api.js';
import './tds-calc.css';

export default function TdsCalculator({ onBack }) {
  const [health, setHealth] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [session, setSession] = useState(null);
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [proposalReview, setProposalReview] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    apiJson('/api/health').then(setHealth).catch(() => setHealth({ status: 'offline' }));
  }, []);

  // Silent dev-bypass login: skip the lekha login screen by minting a session
  // cookie automatically. Backend allows this when GOOGLE_CLIENT_ID/SECRET are
  // unset and ENV != production.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiJson('/auth/me');
        if (cancelled) return;
        if (me.authenticated) {
          setAuthReady(true);
          return;
        }
        if (!me.dev_bypass) {
          setAuthError('Backend requires Google OAuth login, which is not available from this view.');
          return;
        }
        const res = await apiFetch('/auth/dev-login', {
          method: 'POST',
          body: JSON.stringify({ email: 'demo@lekha.ai', name: 'Lekha Demo' }),
        });
        if (!res.ok) throw new Error(await res.text());
        if (!cancelled) setAuthReady(true);
      } catch (e) {
        if (!cancelled) setAuthError(e.message || 'Authentication failed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function reset() {
    setSession(null);
    setPendingQuestion(null);
    setDone(null);
    setProposalReview(false);
  }

  return (
    <div className="tdscalc-shell">
      <header className="tdscalc-header">
        <button className="tdscalc-back" onClick={onBack}>← Back to Checklist</button>
        <div className="tdscalc-title-block">
          <div className="tdscalc-title">Calculate TDS for Deduction</div>
          <div className="tdscalc-sub">Lekha AI · TDS Calculator</div>
        </div>
        <div className="tdscalc-status-pill">
          {health?.status === 'ok'
            ? health.llm_configured ? 'Gemini ready' : 'Mock mode'
            : 'API offline'}
        </div>
      </header>

      <main className="tdscalc-hero">
        {!authReady && !authError && (
          <div className="muted">Connecting to Lekha…</div>
        )}

        {authError && (
          <div className="upload-error" style={{ maxWidth: 480 }}>
            {authError}
          </div>
        )}

        {authReady && !session && (
          <>
            <h1>Calculate TDS on your expenses.</h1>
            <p>
              Upload an Excel or CSV expense file. Lekha reads your columns,
              computes TDS per section, and flags anything ambiguous for a quick review.
            </p>
            <Upload onSessionCreated={setSession} />
          </>
        )}

        {authReady && session && (
          <div className="tdscalc-session-panel">
            <div className="tdscalc-session-header">
              <div className="tdscalc-session-title">Processing {session.filename}</div>
              <button className="btn-ghost" onClick={reset}>Start over</button>
            </div>
            <AgentStream
              sessionId={session.session_id}
              onPendingUserQuestion={setPendingQuestion}
              onProposalReview={() => setProposalReview(true)}
              onDone={setDone}
            />
            {done && <TDSReport sessionId={session.session_id} />}
          </div>
        )}
      </main>

      {pendingQuestion && session && (
        <FlagReview
          payload={pendingQuestion}
          sessionId={session.session_id}
          onAnswered={() => setPendingQuestion(null)}
        />
      )}

      {proposalReview && session && (
        <ProposalReview
          sessionId={session.session_id}
          onComplete={() => setProposalReview(false)}
        />
      )}

      <div className="tdscalc-disclaimer">
        Computational assistance only. Final TDS responsibility rests with the deductor.
      </div>
    </div>
  );
}
