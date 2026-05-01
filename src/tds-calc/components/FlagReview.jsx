import { useState } from 'react';
import { apiFetch } from '../lib/api.js';

/**
 * Sequential flag-review modal. One question at a time with a progress tracker,
 * research note, options, and a recommended answer. Matches the UI sketch
 * confirmed with the founder.
 *
 * payload shape (from a1's ask_user tool):
 *   {
 *     question, options: string[], recommended?, research_note?,
 *     batch?: { id, current, total }, allow_free_text?: bool
 *   }
 */
export default function FlagReview({ payload, sessionId, onAnswered }) {
  const [selected, setSelected] = useState(payload.recommended ?? payload.options?.[0] ?? '');
  const [freeText, setFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const batch = payload.batch;
  const isLastInBatch = !batch || (batch.current >= batch.total);
  const progressPct = batch ? (batch.current / batch.total) * 100 : 0;

  async function submit() {
    setError(null);
    setSubmitting(true);
    const answer = selected === '__other__' ? freeText : selected;
    try {
      const res = await apiFetch(`/api/session/${sessionId}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answer, option_id: selected }),
      });
      if (!res.ok) throw new Error(await res.text());
      onAnswered?.(answer);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flag-modal-backdrop">
      <div className="flag-modal">
        <div className="flag-header">
          <div className="flag-title">Lekha AI · Review</div>
          {batch && (
            <div className="flag-progress">
              Question {batch.current} of {batch.total}
            </div>
          )}
        </div>
        {batch && (
          <div className="flag-progress-bar">
            <div className="flag-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        )}

        <div className="flag-body">
          <div className="flag-question">{payload.question}</div>

          {payload.research_note && (
            <div className="flag-research">
              <div className="flag-research-label">Lekha researched this</div>
              <div className="flag-research-body">{payload.research_note}</div>
            </div>
          )}

          <div className="flag-options">
            {(payload.options || []).map((opt) => {
              const isRecommended = opt === payload.recommended;
              return (
                <label
                  key={opt}
                  className={`flag-option ${selected === opt ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="answer"
                    checked={selected === opt}
                    onChange={() => setSelected(opt)}
                  />
                  <span className="flag-option-label">{opt}</span>
                  {isRecommended && <span className="flag-recommend">Lekha recommends</span>}
                </label>
              );
            })}
            {payload.allow_free_text && (
              <label className={`flag-option ${selected === '__other__' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="answer"
                  checked={selected === '__other__'}
                  onChange={() => setSelected('__other__')}
                />
                <input
                  type="text"
                  placeholder="Other — type your answer"
                  value={freeText}
                  onChange={(e) => {
                    setSelected('__other__');
                    setFreeText(e.target.value);
                  }}
                  className="flag-free-text"
                />
              </label>
            )}
          </div>

          {error && <div className="flag-error">{error}</div>}
        </div>

        <div className="flag-footer">
          <button className="btn-ghost" disabled>Back</button>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={submitting || !selected || (selected === '__other__' && !freeText)}
          >
            {submitting ? 'Submitting…' : (isLastInBatch ? 'Apply & Calculate' : 'Next →')}
          </button>
        </div>
      </div>
    </div>
  );
}
