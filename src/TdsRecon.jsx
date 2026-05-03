import { useState, useRef, useEffect, useMemo } from 'react';
import './tds-recon.css';

const API = '';
const fmt = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

// Agent thinking states and post-completion action options
const AGENT_CONFIG = {
  'Parser Agent': {
    thinkingStates: [
      'Reading Form 26 AS data...',
      'Extracting vendor PANs and sections...',
      'Parsing Tally payment registers...',
      'Cross-referencing TDS ledger entries...',
    ],
    completionActions: ['Show TDS Details', 'Show Summary'],
  },
  'Matcher Agent': {
    thinkingStates: [
      'Learning matching rules from data patterns...',
      'Running exact amount + PAN matching...',
      'Fuzzy matching vendor names and dates...',
      'Resolving multi-entry and split payments...',
    ],
    completionActions: ['Show Matches', 'View Unmatched', 'Show Summary'],
  },
  'TDS Checker': {
    thinkingStates: [
      'Validating TDS rates against Section rules...',
      'Checking for missing Form 26 entries...',
      'Flagging threshold exemptions under \u20B95,000...',
      'Calculating missing TDS exposure...',
    ],
    completionActions: ['View Findings', 'Show Pending Issues', 'Show Summary'],
  },
  'Reporter Agent': {
    thinkingStates: [
      'Compiling reconciliation summary...',
      'Generating section-wise breakdown...',
      'Preparing downloadable reports...',
    ],
    completionActions: ['Show Summary', 'Export Report'],
  },
};

function TdsRecon({ onBack }) {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [visibleEvents, setVisibleEvents] = useState([]);
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [expandedSections, setExpandedSections] = useState(new Set());
  const [reviewDecisions, setReviewDecisions] = useState({});
  const [runCount, setRunCount] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState({ form26: null, tally: null });
  const [useUpload, setUseUpload] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: 'Welcome to TDS Reconciliation. I can help you reconcile Form 26 against Tally books.', actions: ['Run Reconciliation', 'Upload Files'] },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [agentThinkingIdx, setAgentThinkingIdx] = useState({});
  const logRef = useRef(null);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const eventQueueRef = useRef([]);
  const drainTimerRef = useRef(null);
  // Tracks whether the backend already sent pipeline_complete. EventSource
  // fires onerror on the *normal* stream close right after the final event,
  // and we don't want to treat that as a failure (it would clobber the
  // drip-feed with stale /api/results data).
  const pipelineCompleteRef = useRef(false);

  // Auto-scroll chat
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, visibleEvents, agentThinkingIdx]);

  // Cycle thinking states for the currently active agent
  useEffect(() => {
    if (status !== 'running') {
      setAgentThinkingIdx({});
      return;
    }
    const interval = setInterval(() => {
      setAgentThinkingIdx(prev => {
        const next = { ...prev };
        // Find the active agent (last one without agent_done)
        for (const e of visibleEvents) {
          if (e.type === 'agent_start') next._activeAgent = e.agent;
          if (e.type === 'agent_done' && next._activeAgent === e.agent) next._activeAgent = null;
        }
        const active = next._activeAgent;
        if (active && AGENT_CONFIG[active]) {
          const states = AGENT_CONFIG[active].thinkingStates;
          next[active] = ((prev[active] || 0) + 1) % states.length;
        }
        delete next._activeAgent;
        return next;
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [status, visibleEvents]);

  // Drip-feed: reveal queued events one by one with delays
  const drainQueue = () => {
    if (drainTimerRef.current) return; // already draining
    const next = () => {
      const item = eventQueueRef.current.shift();
      if (!item) { drainTimerRef.current = null; return; }

      if (item._pipelineComplete) {
        // Final event — set results and status
        setResults(item.results || null);
        setRunCount(prev => prev + 1);
        setStatus('done');
        const s = item.results?.reconciliation_summary;
        if (s) {
          const insight = buildProactiveInsight(s, item.results?.checker_results, item.results?.match_results);
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: insight.message,
            actions: insight.actions,
          }]);
        }
        drainTimerRef.current = null;
        return;
      }

      setVisibleEvents(prev => [...prev, item]);

      // Delay depends on event type: agent_start gets longer pause
      const delay = item.type === 'agent_start' ? 1200
        : item.type === 'agent_done' ? 800
        : item.type === 'success' ? 600
        : 400;
      drainTimerRef.current = setTimeout(next, delay);
    };
    drainTimerRef.current = setTimeout(next, 100);
  };

  const enqueueEvent = (event) => {
    eventQueueRef.current.push(event);
    drainQueue();
  };

  // Add assistant message helper
  const addAssistantMsg = (content, actions) => {
    setChatMessages(prev => [...prev, { role: 'assistant', content, actions }]);
  };

  // Handle chat commands
  const handleCommand = (text) => {
    const lower = text.toLowerCase().trim();

    if (lower.includes('run') || lower.includes('start') || lower.includes('reconcil')) {
      runPipeline();
      return;
    }
    if (lower.includes('upload')) {
      fileInputRef.current?.click();
      return;
    }
    if (lower.includes('discrepanc') || lower.includes('finding') || lower.includes('error') || lower.includes('issue') || lower.includes('pending')) {
      setActiveTab('pending');
      const pendingCount = findings.filter(f => f.severity === 'error' || f.severity === 'warning').length;
      addAssistantMsg(`Showing ${pendingCount} pending items for review.`);
      return;
    }
    if (lower.includes('reconciled entr') || lower.includes('explore') || lower.includes('match') || lower.includes('tds detail') || lower.includes('show match')) {
      setActiveTab('tds_details');
      addAssistantMsg(`Showing ${matches.length} TDS entries with reconciliation status.`);
      return;
    }
    if (lower.includes('name mismatch') || lower.includes('fuzzy') || lower.includes('name')) {
      setActiveTab('tds_details');
      const fuzzyMatches = matches.filter(m => m.pass_name?.includes('fuzzy'));
      addAssistantMsg(`${fuzzyMatches.length} entries matched via fuzzy name matching. These are shown in TDS Details — look for entries marked "Fuzzy".`);
      return;
    }
    if (lower.includes('remediation') || lower.includes('memo')) {
      setChatMessages(prev => [...prev, {
        role: 'download',
        files: [
          { name: 'tds_recon_report.xlsx', label: 'TDS Recon Report (Excel — 3 sheets)' },
          { name: 'findings_report.csv', label: 'Findings Report with Remediation' },
        ],
      }]);
      addAssistantMsg('Remediation details are included in the findings report — each issue has a recommended action per Income Tax Act provisions.');
      return;
    }
    if (lower.includes('summary') || lower.includes('overview')) {
      setActiveTab('summary');
      addAssistantMsg('Showing section summary.');
      return;
    }
    if (lower.includes('review') || lower.includes('unmatched')) {
      setActiveTab('review');
      addAssistantMsg(`Showing ${unmatchedVendors.length} vendors for review.`);
      return;
    }
    if (lower.includes('export') || lower.includes('report') || lower.includes('download')) {
      setChatMessages(prev => [...prev, {
        role: 'download',
        files: [
          { name: 'tds_recon_report.xlsx', label: 'TDS Recon Report (Excel — 3 sheets)' },
          { name: 'reconciliation_report.csv', label: 'Reconciliation Report (CSV)' },
          { name: 'findings_report.csv', label: 'Findings Report (CSV)' },
        ],
      }]);
      return;
    }
    // Default help
    addAssistantMsg(
      'I can help with:\n- **Run reconciliation** \u2014 execute the full pipeline\n- **Upload files** \u2014 attach Form 26 + Tally XLSX\n- **Show matches / findings / summary / review**\n- **Export report**\n\nOr click any action button below.',
      ['Run Reconciliation', 'Show Matches', 'Show Findings', 'Export Report']
    );
  };

  const sendMessage = () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatMessages(prev => [...prev, { role: 'user', content: text }]);
    setChatInput('');
    handleCommand(text);
  };

  const handleActionClick = (action) => {
    setChatMessages(prev => [...prev, { role: 'user', content: action }]);
    handleCommand(action);
  };

  const handleFilesDrop = (files) => {
    const fileArr = Array.from(files);
    if (fileArr.length >= 2) {
      setUploadedFiles({ form26: fileArr[0], tally: fileArr[1] });
      setUseUpload(true);
      setChatMessages(prev => [...prev, {
        role: 'file-upload',
        files: [{ name: fileArr[0]?.name || 'File 1', label: 'Form 26' }, { name: fileArr[1]?.name || 'File 2', label: 'Tally' }],
      }]);
      addAssistantMsg('Files attached! Ready to parse and reconcile.', ['Upload & Run']);
    } else if (fileArr.length === 1) {
      addAssistantMsg('Please attach both Form 26 and Tally files. You can drag-drop them together.');
    }
  };

  // Upload files then run, or run on existing data
  const runPipeline = async () => {
    setStatus('running');
    setVisibleEvents([]);
    setReviewDecisions({});
    setResults(null);
    // Clear any pending drip-feed from previous run
    eventQueueRef.current = [];
    if (drainTimerRef.current) { clearTimeout(drainTimerRef.current); drainTimerRef.current = null; }
    pipelineCompleteRef.current = false;
    addAssistantMsg('Starting reconciliation pipeline. Running 4 agents: Parser \u2192 Matcher \u2192 TDS Checker \u2192 Reporter...');

    // If user uploaded files, upload them first
    let streamUrl = `${API}/api/run/stream`;
    if (useUpload && uploadedFiles.form26 && uploadedFiles.tally) {
      try {
        const formData = new FormData();
        formData.append('form26', uploadedFiles.form26);
        formData.append('tally', uploadedFiles.tally);
        const uploadRes = await fetch(`${API}/api/upload`, { method: 'POST', body: formData });
        if (!uploadRes.ok) throw new Error('Upload failed');
        streamUrl = `${API}/api/run/stream/upload`;
      } catch (err) {
        setVisibleEvents([{ agent: 'Upload', type: 'error', message: `Upload failed: ${err.message}` }]);
        setStatus('error');
        return;
      }
    }

    try {
      const evtSource = new EventSource(streamUrl);

      evtSource.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data);
          if (event.type === 'keepalive') return;

          if (event.type === 'pipeline_complete') {
            pipelineCompleteRef.current = true;
            evtSource.close();
            // Queue the final event so it drains after all agent events.
            // The drain handler sets results + status='done' AFTER the
            // queue empties, so events render progressively.
            enqueueEvent({ ...event, _pipelineComplete: true });
            return;
          }

          // Queue event for progressive reveal
          enqueueEvent(event);
        } catch (e) {
          // Ignore parse errors
        }
      };

      evtSource.onerror = () => {
        evtSource.close();
        // Normal close right after pipeline_complete — let the drain loop
        // handle results + status. Bailing out here is critical: otherwise
        // we'd overwrite the live SSE results with whatever stale JSON is
        // sitting in /api/results from a previous run.
        if (pipelineCompleteRef.current) return;

        // Real failure (backend died, network dropped mid-stream). Fall
        // back to cached results so the user sees something, but flag it
        // as an error rather than 'done' so the run isn't mistaken for a
        // successful one.
        fetch(`${API}/api/results`).then(r => r.json()).then(data => {
          setResults(data);
          setRunCount(prev => prev + 1);
          setStatus('error');
        }).catch(() => setStatus('error'));
      };
    } catch (err) {
      setVisibleEvents([{ agent: 'Error', type: 'error', message: `Failed to connect to API: ${err.message}. Make sure api_server.py is running on port 8000.` }]);
      setStatus('error');
    }
  };

  // Submit review decisions
  const submitReview = async () => {
    const decisions = Object.entries(reviewDecisions)
      .filter(([, d]) => d.decision)
      .map(([vendor, d]) => ({
        vendor,
        decision: d.decision,
        params: d.params || {},
        reason: d.reason || `Human review: ${d.decision}`,
      }));
    if (decisions.length === 0) return;

    setStatus('running');
    try {
      const res = await fetch(`${API}/api/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions }),
      });
      const data = await res.json();
      // Learning Agent returns its own events (corrections + Checker + Reporter only)
      setVisibleEvents(prev => [...prev, ...(data.events || [])]);
      setResults(data.results || null);
      setRunCount(prev => prev + 1);
      setReviewDecisions({});
      setStatus('done');
    } catch (err) {
      setStatus('error');
    }
  };

  // Derived data
  const summary = results?.reconciliation_summary || null;
  const matchResults = results?.match_results || null;
  const checkerResults = results?.checker_results || null;
  const matches = matchResults?.matches || [];
  const findings = checkerResults?.findings || [];
  const unmatched194cRaw = matchResults?.unmatched_tally_194c || [];
  // Filter out below-threshold entries — they are resolved, not needing review
  const unmatched194c = unmatched194cRaw.filter(e => !e._below_threshold);

  // Group unmatched by vendor
  const unmatchedVendors = useMemo(() => {
    const map = {};
    for (const e of unmatched194c) {
      const v = e.party_name || 'Unknown';
      if (!map[v]) map[v] = { entries: [], total: 0 };
      map[v].entries.push(e);
      map[v].total += e.amount || 0;
    }
    return Object.entries(map)
      .sort((a, b) => b[1].total - a[1].total);
  }, [unmatched194c]);

  // Group matches by section
  const matchesBySection = useMemo(() => {
    const groups = {};
    for (const m of matches) {
      const section = m.form26_entry?.section || 'Unknown';
      if (!groups[section]) groups[section] = [];
      groups[section].push(m);
    }
    return groups;
  }, [matches]);

  const sectionNames = {
    '192': 'Salary (Form 24Q)',
    '194A': 'Interest (other than Interest on Securities)',
    '194C': 'Contractor / Freight',
    '194H': 'Commission / Brokerage',
    '194J(b)': 'Professional Fees',
    '194Q': 'Purchase of Goods',
  };

  const getMatchTypeClass = (passName) => {
    if (!passName) return '';
    if (passName.includes('exact')) return 'exact';
    if (passName.includes('fuzzy')) return 'fuzzy';
    if (passName.includes('aggregated')) return 'aggregated';
    if (passName.includes('gst')) return 'gst';
    return '';
  };

  const getMatchTypeLabel = (passName) => {
    if (!passName) return '';
    if (passName.includes('exact')) return 'Exact';
    if (passName.includes('fuzzy')) return 'Fuzzy';
    if (passName.includes('aggregated')) return 'Agg';
    if (passName.includes('gst')) return 'GST';
    if (passName.includes('exempt')) return 'Exempt';
    return passName;
  };

  const getConfClass = (conf) => {
    if (conf >= 0.9) return 'high';
    if (conf >= 0.7) return 'medium';
    return 'low';
  };

  const getAgentIconClass = (agent) => {
    const a = agent.toLowerCase();
    if (a.includes('parser')) return 'parser';
    if (a.includes('matcher')) return 'matcher';
    if (a.includes('checker')) return 'checker';
    if (a.includes('reporter')) return 'reporter';
    if (a.includes('learning')) return 'learning';
    if (a.includes('pipeline')) return 'pipeline';
    return 'matcher';
  };

  const getAgentIconLetter = (agent) => {
    const a = agent.toLowerCase();
    if (a.includes('parser')) return 'P';
    if (a.includes('matcher')) return 'M';
    if (a.includes('checker')) return 'C';
    if (a.includes('reporter')) return 'R';
    if (a.includes('learning')) return 'L';
    if (a.includes('pipeline')) return '\u2713';
    return '?';
  };

  // Group events by agent for display
  const eventBlocks = useMemo(() => {
    const blocks = [];
    let current = null;
    for (const e of visibleEvents) {
      if (!e || !e.type) continue;
      if (e.type === 'agent_start') {
        if (current) blocks.push(current);
        current = { agent: e.agent, events: [e], startTime: e.elapsed_ms };
      } else if (e.type === 'agent_done') {
        if (current) {
          current.events.push(e);
          current.endTime = e.elapsed_ms;
          blocks.push(current);
          current = null;
        }
      } else {
        if (current && current.agent === e.agent) {
          current.events.push(e);
        } else {
          // Event outside an agent block (like Pipeline complete)
          if (current) blocks.push(current);
          current = null;
          blocks.push({ agent: e.agent, events: [e], standalone: true, startTime: e.elapsed_ms });
        }
      }
    }
    if (current) blocks.push(current);
    return blocks;
  }, [visibleEvents]);

  const toggleSection = (key) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const setDecision = (vendor, decision, params = {}) => {
    setReviewDecisions(prev => ({
      ...prev,
      [vendor]: prev[vendor]?.decision === decision ? {} : { decision, params: { vendor_name: vendor, ...params } },
    }));
  };

  const pendingReviewCount = Object.values(reviewDecisions).filter(d => d.decision).length;

  // Build proactive insight message from pipeline results
  const buildProactiveInsight = (summary, checkerResults, matchResults) => {
    const m = summary.matching || {};
    const c = summary.compliance || {};
    const sw = summary.section_wise || {};
    const findings = checkerResults?.findings || [];
    const actions = ['Review Discrepancies', 'Explore Reconciled Entries', 'Review Name Mismatches', 'Generate Remediation Memo'];

    const lines = [];
    lines.push(`**Reconciliation complete — ${m.total_resolved || 0} entries reconciled.**`);
    lines.push('');

    // Highlight key stats
    lines.push(`${m.matched_with_tds || 0} entries matched with TDS deductions, ${m.below_threshold_resolved || 0} below-threshold entries exempted.`);

    // Unmatched entries — name them
    const unmatched = m.unmatched || 0;
    if (unmatched > 0) {
      const unmatchedEntries = matchResults?.unmatched_form26 || [];
      const vendorSet = new Set(unmatchedEntries.map(e => e.vendor_name));
      const vendors = [...vendorSet].slice(0, 3).join(', ');
      const more = vendorSet.size > 3 ? ` and ${vendorSet.size - 3} more` : '';
      lines.push('');
      lines.push(`**${unmatched} entries could not be matched** — ${vendors}${more}. These need manual verification.`);
    }

    // Compliance findings — be specific
    const warnings = findings.filter(f => f.severity === 'warning');
    const errors = findings.filter(f => f.severity === 'error');
    const missingTds = findings.filter(f => f.check === 'missing_tds');
    const sectionIssues = findings.filter(f => f.check === 'section_validation' && f.severity === 'warning');

    if (missingTds.length > 0) {
      lines.push('');
      const vendors = missingTds.map(f => `**${f.vendor}** (\u20B9${fmt(f.aggregate_amount || 0)})`).join(', ');
      lines.push(`${missingTds.length} vendor(s) with potential missing TDS: ${vendors}. ${missingTds.some(f => f.needs_review) ? 'Flagged for your review — may include year-end adjustments.' : ''}`);
    }

    if (sectionIssues.length > 0) {
      const ambigVendors = new Set(sectionIssues.map(f => f.vendor));
      lines.push('');
      lines.push(`${sectionIssues.length} section classification(s) are ambiguous across ${ambigVendors.size} vendor(s) — verify invoice nature to confirm correct TDS section.`);
    }

    // Section with partial match
    for (const [sec, data] of Object.entries(sw)) {
      if (data.matched_count < data.form26_count && data.form26_count > 0) {
        lines.push('');
        lines.push(`Section ${sec}: ${data.matched_count}/${data.form26_count} matched — \u20B9${fmt(data.form26_amount - data.matched_amount)} unreconciled.`);
      }
    }

    // Fuzzy matches — name mismatch indicator
    const fuzzyCount = (m.by_pass?.fuzzy_match || 0);
    if (fuzzyCount > 0) {
      lines.push('');
      lines.push(`${fuzzyCount} entries matched via fuzzy name matching — names differ between Form 26 and Tally. Worth reviewing for accuracy.`);
    }

    lines.push('');
    lines.push('What would you like to do next?');

    return { message: lines.join('\n'), actions };
  };

  // ═══ RENDER ═══
  return (
    <div className="tds-recon">
      <button className="tds-back-link" onClick={onBack}>
        &larr; Back to Reconciliations
      </button>

      <div className="tds-header">
        <div className="tds-header-left">
          <h1>TDS Reconciliation (all sections)</h1>
          <div className="tds-subtitle">FY 2024-25 | AY 2025-26 | Sections: 192, 194A, 194C, 194H, 194J(b), 194Q</div>
        </div>
        <button
          className="tds-run-btn"
          onClick={runPipeline}
          disabled={status === 'running' || (useUpload && (!uploadedFiles.form26 || !uploadedFiles.tally))}
        >
          {status === 'running' ? <><span className="spinner"></span> Running...</> :
           useUpload ? 'Upload & Run' : 'Run Reconciliation'}
        </button>
      </div>

      <div className={`tds-stacked ${status}`}>
        {/* ── TOP: KPI + Dashboard (expands in data mode) ── */}
        <div className="tds-data-panel">
        <div className="tds-dashboard">
          {/* KPI Cards — always visible */}
          {status !== 'idle' && (() => {
                const m = summary?.matching || {};
                const c = summary?.compliance || {};
                const realExposure = (findings || [])
                  .filter(f => f.severity === 'error' && (f.check === 'missing_tds' || f.check === 'rate_validation' || f.check === 'section_validation'))
                  .reduce((sum, f) => sum + (f.aggregate_amount || f.form26_amount || 0), 0);
                const issuesTdsAmount = (findings || [])
                  .filter(f => f.severity === 'error' || f.severity === 'warning')
                  .reduce((sum, f) => sum + (f.aggregate_amount || f.form26_amount || 0), 0);
                const v = (val) => summary ? val : '\u2014';
                const a = (val) => summary ? `\u20B9${fmt(val)}` : '\u2014';
                return (
                <div className="tds-kpi-row five-col">
                  <div className="tds-kpi-card">
                    <div className="tds-kpi-value">{v((m.total_resolved || 0) + (m.unmatched || 0))}</div>
                    <div className="tds-kpi-label">GE Analysed</div>
                    <div className="tds-kpi-amount">{a(summary?.amounts?.total_form26_payments || 0)}</div>
                    <div className="tds-kpi-sublabel">Total expenses in books</div>
                  </div>
                  <div className="tds-kpi-card clickable" onClick={() => setActiveTab('tds_details')}>
                    <div className="tds-kpi-value">{v(m.total_resolved || 0)}</div>
                    <div className="tds-kpi-label">Reconciled</div>
                    <div className="tds-kpi-amount">{a(summary?.amounts?.matched_payments || 0)}</div>
                    <div className="tds-kpi-sublabel">Expenses reconciled</div>
                  </div>
                  <div className="tds-kpi-card clickable" onClick={() => setActiveTab('tds_details')}>
                    <div className="tds-kpi-value">{v(m.matched_with_tds || 0)}</div>
                    <div className="tds-kpi-label">TDS Reconciled</div>
                    <div className="tds-kpi-amount">{a(summary?.amounts?.matched_tds || 0)}</div>
                    <div className="tds-kpi-sublabel">TDS amount reconciled</div>
                  </div>
                  <div className="tds-kpi-card clickable" onClick={() => setActiveTab('tds_details')}>
                    <div className="tds-kpi-value">{v(m.below_threshold_resolved || 0)}</div>
                    <div className="tds-kpi-label">Expense Exempted</div>
                    <div className="tds-kpi-amount">{a((summary?.amounts?.total_form26_payments || 0) - (summary?.amounts?.matched_payments || 0))}</div>
                    <div className="tds-kpi-sublabel">Exempted expense amount</div>
                  </div>
                  <div className="tds-kpi-card clickable" onClick={() => setActiveTab('pending')}
                    style={{ borderColor: summary ? ((m.unmatched || 0) > 0 ? 'var(--accent-red)' : 'var(--accent-green)') : 'var(--border)' }}>
                    <div className="tds-kpi-value" style={{ color: summary ? ((m.unmatched || 0) > 0 ? 'var(--accent-red)' : 'var(--accent-green)') : 'var(--text-primary)' }}>{v(m.unmatched || 0)}</div>
                    <div className="tds-kpi-label">Flagged for Review</div>
                    <div className="tds-kpi-amount" style={{ color: summary ? ((m.unmatched || 0) > 0 ? 'var(--accent-red)' : 'var(--accent-green)') : 'var(--text-primary)' }}>{a(issuesTdsAmount)}</div>
                    <div className="tds-kpi-sublabel">Amount flagged for review</div>
                  </div>
                </div>
                );
          })()}

          {status === 'idle' ? (
            <div className="tds-empty-state">
              <div className="tds-empty-icon">📋</div>
              <div className="tds-empty-title">Ready to Reconcile</div>
              <div className="tds-empty-desc" style={{ marginBottom: 16 }}>
                Upload your files or run with existing data.
              </div>

              {/* Upload toggle */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'center' }}>
                <button
                  className={`tds-tab ${!useUpload ? 'active' : ''}`}
                  onClick={() => setUseUpload(false)}
                  style={{ fontSize: 12, padding: '4px 12px' }}
                >
                  Use Existing Data
                </button>
                <button
                  className={`tds-tab ${useUpload ? 'active' : ''}`}
                  onClick={() => setUseUpload(true)}
                  style={{ fontSize: 12, padding: '4px 12px' }}
                >
                  Upload New Files
                </button>
              </div>

              {useUpload && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                    Form 26 (.xlsx)
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={e => setUploadedFiles(prev => ({ ...prev, form26: e.target.files[0] || null }))}
                      style={{ fontSize: 12 }}
                    />
                    {uploadedFiles.form26 && <span style={{ color: 'var(--accent-green)' }}>{uploadedFiles.form26.name}</span>}
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                    Tally Extract (.xlsx)
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={e => setUploadedFiles(prev => ({ ...prev, tally: e.target.files[0] || null }))}
                      style={{ fontSize: 12 }}
                    />
                    {uploadedFiles.tally && <span style={{ color: 'var(--accent-green)' }}>{uploadedFiles.tally.name}</span>}
                  </label>
                </div>
              )}
            </div>
          ) : (
            <>

              {/* Tabs + mode toggle */}
              <div className="tds-tabs">
                {['summary', 'tds_details', 'pending'].map(tab => (
                  <button
                    key={tab}
                    className={`tds-tab ${activeTab === tab ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === 'summary' ? 'Section Summary' :
                     tab === 'tds_details' ? `TDS Details (${matches.length})` :
                     <span>Pending ({findings.filter(f => f.severity === 'error' || f.severity === 'warning').length})<span title="TDS deduction which needs review" style={{ cursor: 'help', marginLeft: 2 }}>*</span></span>}
                  </button>
                ))}
              </div>

              {/* ── Tab: Section Summary ── */}
              {activeTab === 'summary' && summary && (
                <div>
                  {Object.entries(summary.section_wise || {}).map(([section, data]) => {
                    // Find findings for this section
                    const sectionFindings = (findings || []).filter(f =>
                      (f.form26_section === section || f.expected_section === section) &&
                      (f.severity === 'error' || f.severity === 'warning')
                    );
                    return (
                    <div key={section} className="tds-section-group">
                      <button className="tds-section-header" onClick={() => toggleSection(section)}>
                        <span className={`tds-section-chevron ${expandedSections.has(section) ? 'open' : ''}`}>&#9654;</span>
                        <span className="tds-section-name">
                          {section} {sectionNames[section] ? `\u2014 ${sectionNames[section]}` : ''}
                        </span>
                        <span className="tds-section-count">{data.form26_count} entries</span>
                        <span className={`tds-section-status-badge ${
                          sectionFindings.length > 0 ? 'issue' :
                          data.matched_count === data.form26_count ? 'matched' : 'pending'
                        }`}>
                          {sectionFindings.length > 0 ? `${sectionFindings.length} issues` :
                           data.matched_count === data.form26_count ? 'Matched' :
                           data.not_in_scope ? 'Not in Scope' : `${data.matched_count}/${data.form26_count}`}
                        </span>
                      </button>
                      {expandedSections.has(section) && (
                        <div className="tds-section-body" style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: 12, color: 'var(--text-secondary)', marginBottom: sectionFindings.length ? 8 : 0 }}>
                            <div>Amount: <strong>{'\u20B9'}{fmt(data.form26_amount || 0)}</strong></div>
                            <div>TDS: <strong>{'\u20B9'}{fmt(data.form26_tds || 0)}</strong></div>
                            <div>Matched: <strong>{'\u20B9'}{fmt(data.matched_amount || 0)}</strong></div>
                          </div>
                          {sectionFindings.map((f, fi) => (
                            <div key={fi} style={{ fontSize: 11, padding: '4px 0', color: f.severity === 'error' ? 'var(--accent-red)' : 'var(--accent-orange)', borderTop: fi === 0 ? '1px solid var(--border)' : 'none', marginTop: fi === 0 ? 4 : 0 }}>
                              {f.severity === 'error' ? '\u2717' : '\u26A0'} {f.vendor}: {f.message?.slice(0, 100)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}

              {/* ── Tab: TDS Details ── */}
              {activeTab === 'tds_details' && (
                <div>
                  {Object.entries(matchesBySection).map(([section, sectionMatches]) => (
                    <div key={section} className="tds-section-group">
                      <button className="tds-section-header" onClick={() => toggleSection(`m_${section}`)}>
                        <span className={`tds-section-chevron ${expandedSections.has(`m_${section}`) ? 'open' : ''}`}>&#9654;</span>
                        <span className="tds-section-name">Section {section} {sectionNames[section] ? `\u2014 ${sectionNames[section]}` : ''}</span>
                        <span className="tds-section-count">{sectionMatches.length} entries</span>
                        <span className="tds-section-status-badge matched">Reconciled</span>
                      </button>
                      {expandedSections.has(`m_${section}`) && (
                        <div className="tds-section-body">
                          {sectionMatches.map((m, i) => (
                            <div key={i} className="tds-match-row">
                              <div className="tds-match-vendor">{m.form26_entry?.vendor_name || 'Unknown'}</div>
                              <div className="tds-match-amount">{'\u20B9'}{fmt(m.form26_entry?.amount_paid || 0)}</div>
                              <div className="tds-match-amount" style={{ fontSize: 10, color: 'var(--text-muted)' }}>TDS {'\u20B9'}{fmt(m.form26_entry?.tax_deducted || 0)}</div>
                              <div className={`tds-match-type ${getMatchTypeClass(m.pass_name)}`}>
                                {getMatchTypeLabel(m.pass_name)}
                              </div>
                              <div className={`tds-match-confidence ${getConfClass(m.confidence || 0)}`}>
                                {((m.confidence || 0) * 100).toFixed(0)}%
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {/* Exempt / Zero TDS group */}
                  {(() => {
                    const exemptCount = matchResults?.exemptions?.length || 0;
                    const btCount = summary?.matching?.below_threshold_resolved || 0;
                    if (exemptCount + btCount === 0) return null;
                    return (
                      <div className="tds-section-group">
                        <button className="tds-section-header" onClick={() => toggleSection('zero_tds')}>
                          <span className={`tds-section-chevron ${expandedSections.has('zero_tds') ? 'open' : ''}`}>&#9654;</span>
                          <span className="tds-section-name">Zero TDS / Exempt</span>
                          <span className="tds-section-count">{exemptCount + btCount} entries</span>
                          <span className="tds-section-status-badge matched">No TDS Required</span>
                        </button>
                        {expandedSections.has('zero_tds') && (
                          <div className="tds-section-body" style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)' }}>
                            {btCount > 0 && <div>{btCount} below-threshold entries (aggregate below annual limit)</div>}
                            {exemptCount > 0 && <div>{exemptCount} exempt entries (Form 15G/15H or lower deduction certificate)</div>}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Tab: Pending to Reconcile ── */}
              {activeTab === 'pending' && (
                <div>
                  {(() => {
                    const pendingItems = (findings || []).filter(f => f.severity === 'error' || f.severity === 'warning');
                    if (pendingItems.length === 0) return (
                      <div className="tds-empty-state">
                        <div className="tds-empty-title">All Clear</div>
                        <div className="tds-empty-desc">No pending items. All entries are reconciled.</div>
                      </div>
                    );
                    return pendingItems.map((f, i) => (
                      <div key={i} className="tds-finding-row">
                        <div className="tds-finding-icon">
                          {f.severity === 'error' ? '\u2717' : '\u26A0'}
                        </div>
                        <div className="tds-finding-content">
                          <div className="tds-finding-header">
                            <span className="tds-finding-vendor">{f.vendor || 'Unknown'}</span>
                            <span className={`tds-finding-severity ${f.severity}`}>{f.severity}</span>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{f.check || ''}</span>
                          </div>
                          <div className="tds-finding-message">{f.message || ''}</div>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </>
          )}
        </div>
        </div>{/* end tds-data-panel */}

        {/* ── BOTTOM: Chat + Agent Activity (expands in chat mode) ── */}
        <div className="tds-chat-panel">
        <div className="tds-activity"
          onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }}
          onDragLeave={e => { e.currentTarget.classList.remove('drag-over'); }}
          onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); handleFilesDrop(e.dataTransfer.files); }}
        >
          <div className="tds-activity-header">
            <div className={`tds-activity-dot ${status === 'running' ? '' : 'idle'}`} />
            Lekha AI
            {runCount > 0 && <span className="tds-rules-badge">Run #{runCount}</span>}
          </div>
          <div className="tds-chat-body" ref={logRef}>
            {/* Chat messages */}
            {chatMessages.map((msg, mi) => {
              // Is this the last user message?
              const isLastUser = msg.role === 'user' && mi === chatMessages.findLastIndex(m => m.role === 'user');
              return (
              <div key={`msg-${mi}`} className={isLastUser ? 'tds-sticky-msg' : ''}>
                {msg.role === 'user' && (
                  <div className="tds-chat-user">
                    <div className="tds-chat-user-bubble">{msg.content}</div>
                  </div>
                )}
                {msg.role === 'assistant' && (
                  <div className="tds-chat-assistant">
                    <div className="tds-chat-avatar">L</div>
                    <div className="tds-chat-assistant-content">
                      <div className="tds-chat-assistant-bubble">
                        {msg.content.split('\n').map((line, li) => (
                          <span key={li}>
                            {line.replace(/\*\*(.*?)\*\*/g, '\u200B$1').split('\u200B').map((part, pi) =>
                              pi % 2 === 1 ? <strong key={pi}>{part}</strong> : part
                            )}
                            {li < msg.content.split('\n').length - 1 && <br />}
                          </span>
                        ))}
                      </div>
                      {msg.actions && (
                        <div className="tds-chat-actions">
                          {msg.actions.map((a, ai) => (
                            <button key={ai} className="tds-chat-action-chip" onClick={() => handleActionClick(a)}>{a}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {msg.role === 'file-upload' && (
                  <div className="tds-chat-user">
                    <div className="tds-chat-file-bubble">
                      {msg.files.map((f, fi) => (
                        <div key={fi} className="tds-chat-file-item">
                          <span className="tds-chat-file-icon">{'\uD83D\uDCC4'}</span>
                          <span>{f.label}: {f.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {msg.role === 'download' && (
                  <div className="tds-chat-assistant">
                    <div className="tds-chat-avatar">L</div>
                    <div className="tds-chat-assistant-content">
                      <div className="tds-chat-assistant-bubble">Download your reports:</div>
                      <div className="tds-chat-download-list">
                        {msg.files.map((f, fi) => (
                          <a key={fi} className="tds-chat-download-link" href={`${API}/api/download/${f.name}`} download={f.name}>
                            <span className="tds-chat-download-icon">{'\u2B07'}</span>
                            {f.label}
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Render agent blocks after the "Starting pipeline" assistant message */}
                {mi === chatMessages.findIndex(m => m.content?.includes('Starting reconciliation')) && eventBlocks.length > 0 && (
                  <div className="tds-chat-agent-blocks">
                    {eventBlocks.map((block, bi) => {
                      const isDone = block.events.some(e => e.type === 'agent_done');
                      const isActive = !isDone && !block.standalone && status === 'running';
                      const config = AGENT_CONFIG[block.agent];
                      const thinkingIdx = agentThinkingIdx[block.agent] || 0;
                      const thinkingText = config?.thinkingStates?.[thinkingIdx] || null;

                      return (
                        <div key={bi} className={`tds-agent-block ${isActive ? 'active' : ''}`}>
                          <div className="tds-agent-header">
                            <div className={`tds-agent-icon ${getAgentIconClass(block.agent)}`}>
                              {getAgentIconLetter(block.agent)}
                            </div>
                            <span className="tds-agent-name">{block.agent}</span>
                            {isActive && (
                              <span className="tds-agent-status-badge running">Working</span>
                            )}
                            {isDone && block.endTime != null && block.startTime != null && (
                              <span className="tds-agent-time">
                                {((block.endTime - block.startTime) / 1000).toFixed(1)}s
                              </span>
                            )}
                            {isDone && (
                              <span className="tds-agent-status-icon" style={{ color: 'var(--accent-green)' }}>{'\u2713'}</span>
                            )}
                          </div>

                          {/* Thinking indicator while agent is active */}
                          {isActive && thinkingText && (
                            <div className="tds-agent-thinking">
                              <div className="tds-agent-thinking-dot" />
                              <span className="tds-thinking-text">{thinkingText}</span>
                            </div>
                          )}

                          {/* Detail log lines */}
                          {block.events
                            .filter(e => e.type !== 'agent_start' && e.type !== 'agent_done')
                            .map((e, ei) => (
                              <div key={ei} className={`tds-log-line ${e.type}`} style={{ animationDelay: `${ei * 0.05}s` }}>
                                <span className="log-prefix">
                                  {e.type === 'detail' ? '\u251C\u2500' : e.type === 'success' ? '\u2713' : e.type === 'error' ? '\u2717' : e.type === 'warning' ? '\u26A0' : '\u2022'}
                                </span>
                                {e.message}
                              </div>
                            ))}

                          {/* Completion action chips */}
                          {isDone && config?.completionActions && (
                            <div className="tds-agent-actions">
                              {config.completionActions.map((action, ai) => (
                                <button key={ai} className="tds-chat-action-chip small" onClick={() => handleActionClick(action)}>{action}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {status === 'running' && (
                      <div className="tds-typing">
                        <div className="tds-typing-dot" />
                        <div className="tds-typing-dot" />
                        <div className="tds-typing-dot" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )})}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input bar */}
          <div className="tds-chat-input-bar">
            <button className="tds-chat-attach-btn" onClick={() => fileInputRef.current?.click()} title="Attach files">
              {'\uD83D\uDCCE'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files.length) handleFilesDrop(e.target.files); e.target.value = ''; }}
            />
            <input
              className="tds-chat-input"
              type="text"
              placeholder="Type a message or drop files..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              disabled={status === 'running'}
            />
            <button className="tds-chat-send-btn" onClick={sendMessage} disabled={!chatInput.trim() || status === 'running'}>
              {'\u2192'}
            </button>
          </div>
        </div>
        </div>{/* end tds-chat-panel */}
      </div>
    </div>
  );
}

export default TdsRecon;
