import { useEffect, useState } from 'react';
import { apiFetch, apiJson } from '../lib/api.js';
import { formatINR } from '../lib/format.js';

/**
 * Proposal review modal — driven entirely by the frontend.
 *
 * Fetches ALL proposals from /api/session/<id>/proposals once.
 * Walks the user through them locally (no LLM in the loop). Each click POSTs
 * one answer to /proposal/answer. After the last one, POSTs /proposal/complete
 * which resumes a1.
 */
export default function ProposalReview({ sessionId, onComplete }) {
  const [proposals, setProposals] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});  // index -> {section?, skip_reason?, free_text?, note?}
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    apiJson(`/api/session/${sessionId}/proposals`)
      .then((data) => setProposals(data.proposals || []))
      .catch((e) => setLoadError(e.message));
  }, [sessionId]);

  if (loadError) {
    return (
      <div className="flag-modal-backdrop">
        <div className="flag-modal">
          <div className="flag-body">
            <div className="flag-error">Failed to load proposals: {loadError}</div>
          </div>
        </div>
      </div>
    );
  }
  if (proposals === null) {
    return (
      <div className="flag-modal-backdrop">
        <div className="flag-modal">
          <div className="flag-body"><div className="muted">Loading proposals…</div></div>
        </div>
      </div>
    );
  }
  if (proposals.length === 0) {
    return null;
  }

  const total = proposals.length;
  const current = proposals[idx];
  const recommended = current?.recommended || {};
  const isLast = idx === total - 1;
  const progressPct = ((idx + 1) / total) * 100;

  // Build the option list — recommended first, then alternates.
  // Backstop: if b3 didn't supply options, derive them from the recommendation.
  let baseOptions = current?.options || [];
  if (baseOptions.length === 0 && recommended) {
    const fallback = [];
    if (recommended.section) fallback.push(`Apply ${recommended.section}`);
    if (recommended.skip_reason) {
      fallback.push(`Skip TDS — ${String(recommended.skip_reason).replace(/_/g, ' ')}`);
    }
    if (fallback.length === 0) {
      // Last-resort defaults for popups with no signal at all.
      fallback.push('Apply 194C', 'Apply 194J(b)', 'Skip TDS');
    }
    baseOptions = fallback;
  }
  const allOptions = [...new Set(baseOptions)];

  const currentAnswer = answers[idx] || {};
  const selectedKey = currentAnswer.option_key
    ?? (recommended.section ? `apply:${recommended.section}` : recommended.skip_reason ? `skip:${recommended.skip_reason}` : null);

  function pickOption(opt, optionKey) {
    setAnswers((a) => ({ ...a, [idx]: { option_key: optionKey, label: opt } }));
  }

  function pickFreeText(text) {
    setAnswers((a) => ({ ...a, [idx]: { option_key: 'free', label: 'Other', free_text: text } }));
  }

  async function submitAndAdvance() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const ans = answers[idx];
      if (!ans) {
        setSubmitError('Pick an option first.');
        setSubmitting(false);
        return;
      }
      // Build the answer payload that apply_flag_resolutions expects.
      const payload = buildAnswerPayload(ans, current);
      const res = await apiFetch(`/api/session/${sessionId}/proposal/answer`, {
        method: 'POST',
        body: JSON.stringify({ proposal_index: idx, answer: payload }),
      });
      if (!res.ok) throw new Error(await res.text());

      if (isLast) {
        // Tell server we're done; this resumes a1.
        const c = await apiFetch(`/api/session/${sessionId}/proposal/complete`, { method: 'POST' });
        if (!c.ok) throw new Error(await c.text());
        onComplete?.();
      } else {
        setIdx(idx + 1);
      }
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function back() {
    if (idx > 0) setIdx(idx - 1);
  }

  return (
    <div className="flag-modal-backdrop">
      <div className="flag-modal">
        <div className="flag-header">
          <div className="flag-title">Lekha AI · Review</div>
          <div className="flag-progress">Question {idx + 1} of {total}</div>
        </div>
        <div className="flag-progress-bar">
          <div className="flag-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>

        <div className="flag-body">
          <div className="flag-question">
            {current.description}
          </div>
          <div className="proposal-meta">
            <span>{current.row_count} rows</span>
            <span>·</span>
            <span>Total {formatINR(current.total_amount)}</span>
            {current.sample_vendors?.length > 0 && (
              <>
                <span>·</span>
                <span>Vendors: {current.sample_vendors.slice(0, 3).join(', ')}{current.sample_vendors.length > 3 ? '…' : ''}</span>
              </>
            )}
          </div>

          {current.research_note && (
            <div className="flag-research">
              <div className="flag-research-label">
                Lekha researched this
                {current.source && <span className="research-source"> · {current.source}</span>}
                {recommended.confidence && <span className="research-conf"> · confidence: {recommended.confidence}</span>}
              </div>
              <div className="flag-research-body">{current.research_note}</div>
            </div>
          )}

          <div className="flag-options">
            {allOptions.map((opt) => {
              const optKey = String(opt);
              const isRecommended = recommended.section
                ? opt.toLowerCase().includes(String(recommended.section).toLowerCase())
                : recommended.skip_reason && (opt.toLowerCase().startsWith('skip') || opt.toLowerCase().includes('exempt'));
              return (
                <label
                  key={optKey}
                  className={`flag-option ${selectedKey === optKey ? 'selected' : ''}`}
                  onClick={() => pickOption(opt, optKey)}
                >
                  <input
                    type="radio"
                    name={`proposal-${idx}`}
                    checked={selectedKey === optKey}
                    onChange={() => pickOption(opt, optKey)}
                  />
                  <span className="flag-option-label">{opt}</span>
                  {isRecommended && <span className="flag-recommend">Lekha recommends</span>}
                </label>
              );
            })}
            <label className={`flag-option ${currentAnswer.option_key === 'free' ? 'selected' : ''}`}>
              <input
                type="radio"
                name={`proposal-${idx}`}
                checked={currentAnswer.option_key === 'free'}
                onChange={() => pickFreeText(currentAnswer.free_text || '')}
              />
              <input
                type="text"
                placeholder="Other — enter section (e.g. 194I) or 'skip'"
                value={currentAnswer.free_text || ''}
                onChange={(e) => pickFreeText(e.target.value)}
                className="flag-free-text"
              />
            </label>
          </div>

          {submitError && <div className="flag-error">{submitError}</div>}
        </div>

        <div className="flag-footer">
          <button className="btn-ghost" onClick={back} disabled={idx === 0 || submitting}>Back</button>
          <button
            className="btn-primary"
            onClick={submitAndAdvance}
            disabled={submitting || !answers[idx]}
          >
            {submitting ? 'Saving…' : isLast ? 'Apply & calculate' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Convert UI selection into the resolution payload apply_flag_resolutions expects.
 *
 * Heuristics:
 *   - option key starts with "apply:<sec>" → {section: sec}
 *   - option key starts with "skip:<reason>" → {skip_reason: reason}
 *   - free text "skip" or "no tds" → {skip_reason: "user_skip"}
 *   - free text matching section pattern → {section: parsed}
 *   - else: pass label as note + assume the recommended action
 */
function buildAnswerPayload(answer, proposal) {
  const out = {
    row_ids: proposal.row_ids || [],
    note: answer.label || 'user_resolved',
  };
  const recommended = proposal.recommended || {};

  if (answer.option_key === 'free') {
    const text = (answer.free_text || '').trim();
    if (/^(skip|no tds|exempt)/i.test(text)) {
      out.skip_reason = 'user_skip';
      out.note = text || 'user_skip';
      return out;
    }
    const sec = text.match(/19[0-9][A-Za-z]?(\([a-z]\))?/i);
    if (sec) {
      out.section = sec[0];
      out.note = `manual: ${text}`;
      return out;
    }
    out.note = `manual: ${text}`;
    return out;
  }

  // Parse option label for a section reference.
  const label = answer.label || '';
  const secMatch = label.match(/19[0-9][A-Za-z]?(\([a-z]\))?/i);
  if (/skip|exempt|no tds/i.test(label)) {
    out.skip_reason = recommended.skip_reason || 'user_skip';
    return out;
  }
  if (secMatch) {
    out.section = secMatch[0];
    return out;
  }
  // Fall back to the recommendation.
  if (recommended.section) {
    out.section = recommended.section;
  } else if (recommended.skip_reason) {
    out.skip_reason = recommended.skip_reason;
  }
  return out;
}
