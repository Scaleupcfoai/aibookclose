import { useEffect, useRef, useState } from 'react';

const AGENT_LABELS = {
  orchestrator: 'Lekha',
  column_reader: 'Column Reader',
  tds_calculator: 'TDS Calculator',
};

const TOOL_LABELS = {
  fingerprint_columns: 'Reading headers + samples',
  read_headers: 'Reading headers',
  read_samples: 'Reading sample rows',
  ask_orchestrator: 'Asking Lekha',
  invoke_column_reader: 'Delegating to Column Reader',
  invoke_tds_calculator: 'Delegating to TDS Calculator',
  web_search: 'Researching',
  ask_user: 'Asking you',
  return_final_result: 'Finalising',
  apply_flag_resolutions: 'Applying your answers',
};

/**
 * Live SSE stream of agent activity. Renders each meaningful event as a row.
 * Emits `onPendingUserQuestion` when the orchestrator is waiting on the user.
 */
export default function AgentStream({ sessionId, onPendingUserQuestion, onProposalReview, onDone }) {
  const [rows, setRows] = useState([]);
  const seenRef = useRef(new Set());

  useEffect(() => {
    if (!sessionId) return undefined;
    const es = new EventSource(`/api/session/${sessionId}/stream`, { withCredentials: true });
    es.onmessage = (e) => {
      let record;
      try { record = JSON.parse(e.data); } catch { return; }
      const key = `${record.t}:${record.event}:${record.agent}:${record.tool ?? ''}`;
      if (seenRef.current.has(key)) return;
      seenRef.current.add(key);

      const row = formatRow(record);
      if (row) setRows((r) => [...r, row]);

      if (record.event === 'awaiting_user') {
        onPendingUserQuestion?.(record.payload);
      }
      if (record.event === 'awaiting_proposal_review') {
        onProposalReview?.(record);
      }
      if (record.event === 'orchestrator_done') {
        onDone?.(record);
      }
    };
    es.onerror = () => { /* connection will retry naturally */ };
    return () => es.close();
  }, [sessionId, onPendingUserQuestion, onDone]);

  return (
    <div className="agent-stream">
      {rows.length === 0 && <div className="stream-row muted">Lekha is getting ready…</div>}
      {rows.map((r, i) => (
        <div key={i} className={`stream-row ${r.level}`}>
          <span className="stream-agent">{r.agent}</span>
          <span className="stream-text">{r.text}</span>
        </div>
      ))}
    </div>
  );
}

function formatRow(r) {
  const agent = AGENT_LABELS[r.agent] ?? r.agent ?? 'Lekha';
  if (r.event === 'tool_call') {
    const label = TOOL_LABELS[r.tool] ?? r.tool;
    return { agent, text: label + '…', level: 'info' };
  }
  if (r.event === 'tool_result') {
    const label = TOOL_LABELS[r.tool] ?? r.tool;
    return { agent, text: label + ' done', level: 'ok' };
  }
  if (r.event === 'llm_call_done' && r.text) {
    return { agent, text: r.text, level: 'think' };
  }
  if (r.event === 'awaiting_user') return null;
  if (r.event === 'orchestrator_done') {
    return { agent, text: 'Done', level: 'ok' };
  }
  if (r.event === 'orchestrator_error') {
    return { agent, text: r.error, level: 'error' };
  }
  if (r.event === 'session_killed') {
    return { agent, text: `Session stopped: ${r.reason}`, level: 'error' };
  }
  return null;
}
