import { useState, useRef, useEffect } from 'react';
import './gst-recon.css';

const API = '';
const fmt = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

const AGENT_CONFIG = {
  'GST Output Agent': {
    thinkingStates: ['Comparing GSTR-1 filed sales with books...', 'Checking monthly taxable value variances...'],
  },
  'GST ITC Agent': {
    thinkingStates: ['Matching GSTR-2B invoices against purchase register...', 'Cross-referencing vendor GSTINs...'],
  },
  'GST Liability Agent': {
    thinkingStates: ['Comparing GSTR-1 liability with GSTR-3B payments...', 'Checking monthly tax discharge...'],
  },
};

function GstRecon({ onBack, agentType }) {
  const [status, setStatus] = useState('idle');
  const [events, setEvents] = useState([]);
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const titles = {
    'gst-output': 'GST Output Recon — GSTR-1 vs Sales Register',
    'gst-itc': 'GST ITC Recon — GSTR-2B vs Purchase Register',
    'gst-liability': 'GST Liability Recon — GSTR-1 vs GSTR-3B',
  };

  const runPipeline = async () => {
    setStatus('running');
    setEvents([]);
    setResults(null);

    try {
      const evtSource = new EventSource(`${API}/api/gst/run/stream`);
      evtSource.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data);
          if (event.type === 'keepalive') return;
          if (event.type === 'pipeline_complete') {
            evtSource.close();
            setResults(event.results);
            setStatus('done');
            return;
          }
          setEvents(prev => [...prev, event]);
        } catch (e) { /* ignore */ }
      };
      evtSource.onerror = () => {
        evtSource.close();
        fetch(`${API}/api/gst/results`).then(r => r.json()).then(data => {
          setResults(data);
          setStatus('done');
        }).catch(() => setStatus('error'));
      };
    } catch (err) {
      setStatus('error');
    }
  };

  // Get agent-specific results
  const agentResult = results?.[agentType?.replace('-', '_')] || null;
  const summary = agentResult?.summary || {};
  const findings = agentResult?.findings || [];
  const monthly = agentResult?.monthly || {};
  const matched = agentResult?.matched || [];

  return (
    <div className="gst-recon">
      <button className="gst-back-link" onClick={onBack}>← Back to Reconciliations</button>

      <div className="gst-header">
        <div>
          <h1>{titles[agentType] || 'GST Reconciliation'}</h1>
          <div className="gst-subtitle">FY 2024-25 | Q1 (Apr–Jun)</div>
        </div>
        <button className="gst-run-btn" onClick={runPipeline} disabled={status === 'running'}>
          {status === 'running' ? <><span className="spinner"></span> Running...</> : 'Run Reconciliation'}
        </button>
      </div>

      <div className="gst-stacked">
        {/* KPI Bar */}
        {status !== 'idle' && (
          <div className="gst-kpi-row">
            {agentType === 'gst-itc' && <>
              <div className="gst-kpi">{summary.total_2b_invoices ?? '—'}<span>2B Invoices</span></div>
              <div className="gst-kpi">{summary.matched ?? '—'}<span>Matched</span></div>
              <div className="gst-kpi">{summary.match_rate ? `${summary.match_rate}%` : '—'}<span>Match Rate</span></div>
              <div className="gst-kpi" style={{color: (summary.in_2b_not_books || 0) > 0 ? '#DC2626' : '#16A34A'}}>
                {summary.in_2b_not_books ?? '—'}<span>Unmatched</span>
              </div>
              <div className="gst-kpi">₹{fmt(summary.unmatched_itc || 0)}<span>ITC at Risk</span></div>
            </>}
            {agentType === 'gst-output' && <>
              <div className="gst-kpi">{summary.months_compared ?? '—'}<span>Months</span></div>
              <div className="gst-kpi">{summary.months_matched ?? '—'}<span>Matched</span></div>
              <div className="gst-kpi">₹{fmt(summary.total_books_sales || 0)}<span>Books Sales</span></div>
              <div className="gst-kpi">₹{fmt(summary.total_gstr1_taxable || 0)}<span>GSTR-1 Filed</span></div>
              <div className="gst-kpi" style={{color: Math.abs(summary.total_variance || 0) > 1000 ? '#DC2626' : '#16A34A'}}>
                ₹{fmt(Math.abs(summary.total_variance || 0))}<span>Variance</span>
              </div>
            </>}
            {agentType === 'gst-liability' && <>
              <div className="gst-kpi">{summary.months_compared ?? '—'}<span>Months</span></div>
              <div className="gst-kpi">{summary.months_matched ?? '—'}<span>Matched</span></div>
              <div className="gst-kpi">₹{fmt(summary.total_gstr1_tax || 0)}<span>GSTR-1 Tax</span></div>
              <div className="gst-kpi">₹{fmt(summary.total_gstr3b_tax || 0)}<span>GSTR-3B Paid</span></div>
              <div className="gst-kpi" style={{color: Math.abs(summary.total_diff || 0) > 100 ? '#DC2626' : '#16A34A'}}>
                ₹{fmt(Math.abs(summary.total_diff || 0))}<span>Difference</span>
              </div>
            </>}
          </div>
        )}

        {/* Data Panel */}
        {status === 'done' && (
          <div className="gst-data-panel">
            <div className="gst-tabs">
              {['summary', 'findings'].map(tab => (
                <button key={tab} className={`gst-tab ${activeTab === tab ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab)}>
                  {tab === 'summary' ? 'Monthly Summary' : `Findings (${findings.length})`}
                </button>
              ))}
              {agentType === 'gst-itc' && (
                <button className={`gst-tab ${activeTab === 'matched' ? 'active' : ''}`}
                  onClick={() => setActiveTab('matched')}>
                  Matched ({matched.length})
                </button>
              )}
            </div>

            {activeTab === 'summary' && (
              <div className="gst-monthly-grid">
                {Object.entries(monthly).map(([month, data]) => (
                  <div key={month} className={`gst-month-card ${data.status === 'matched' ? 'ok' : 'issue'}`}>
                    <div className="gst-month-name">{month}</div>
                    {agentType === 'gst-output' && <>
                      <div className="gst-row"><span>Books Sales</span><span>₹{fmt(data.books_sales)}</span></div>
                      <div className="gst-row"><span>GSTR-1 Taxable</span><span>₹{fmt(data.gstr1_taxable)}</span></div>
                      <div className="gst-row gst-variance">
                        <span>{data.status === 'matched' ? 'Matched ✓' : 'Variance'}</span>
                        {data.status !== 'matched' && <span style={{color:'#DC2626'}}>₹{fmt(Math.abs(data.variance))} ({data.variance_pct}%)</span>}
                      </div>
                    </>}
                    {agentType === 'gst-liability' && <>
                      <div className="gst-row"><span>GSTR-1 Tax</span><span>₹{fmt(data.gstr1_tax)}</span></div>
                      <div className="gst-row"><span>GSTR-3B Paid</span><span>₹{fmt(data.gstr3b_tax)}</span></div>
                      <div className="gst-row gst-variance">
                        <span>{data.status === 'matched' ? 'Matched ✓' : 'Difference'}</span>
                        {data.status !== 'matched' && <span style={{color:'#DC2626'}}>₹{fmt(Math.abs(data.tax_diff))}</span>}
                      </div>
                    </>}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'findings' && (
              <div className="gst-findings">
                {findings.length === 0 ? (
                  <div className="gst-empty">No issues found. All reconciled.</div>
                ) : findings.map((f, i) => (
                  <div key={i} className={`gst-finding ${f.severity}`}>
                    <span className="gst-finding-icon">{f.severity === 'error' ? '✗' : '⚠'}</span>
                    <div className="gst-finding-content">
                      <div className="gst-finding-msg">{f.message}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'matched' && agentType === 'gst-itc' && (
              <div className="gst-matched-table">
                <div className="gst-table-header">
                  <span>Vendor (2B)</span><span>Vendor (Books)</span><span>Amount</span><span>ITC</span>
                </div>
                {matched.slice(0, 50).map((m, i) => (
                  <div key={i} className="gst-table-row">
                    <span>{m.vendor_2b || m.vendor}</span>
                    <span>{m.vendor_books || '—'}</span>
                    <span>₹{fmt(m.amount_2b)}</span>
                    <span>₹{fmt(m.itc_2b)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Chat Panel */}
        <div className="gst-chat-panel">
          <div className="gst-chat-header">
            <div className={`gst-dot ${status === 'running' ? 'active' : ''}`} />
            Lekha AI
          </div>
          <div className="gst-chat-body">
            {status === 'idle' && (
              <div className="gst-chat-msg">Click "Run Reconciliation" to start the GST pipeline.</div>
            )}
            {events.map((e, i) => (
              <div key={i} className={`gst-event ${e.type}`}>
                <span className="gst-event-prefix">
                  {e.type === 'success' ? '✓' : e.type === 'warning' ? '⚠' : e.type === 'error' ? '✗' : '├─'}
                </span>
                <span className="gst-event-agent">[{e.agent}]</span> {e.message}
              </div>
            ))}
            {status === 'done' && (
              <div className="gst-chat-msg gst-done">
                GST reconciliation complete. {findings.length} finding(s).
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default GstRecon;
