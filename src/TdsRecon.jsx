import { useState, useRef, useEffect, useMemo } from 'react';
import { API_URL, ENDPOINTS } from './config';
import { api, createAuthSSE, getAuthToken } from './services/api';
import { useAuth } from './contexts/AuthContext';
import './tds-recon.css';

const fmt = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

// Polyfill for browsers lacking Array.prototype.findLastIndex
if (!Array.prototype.findLastIndex) {
  Array.prototype.findLastIndex = function (fn) {
    for (let i = this.length - 1; i >= 0; i--) {
      if (fn(this[i], i, this)) return i;
    }
    return -1;
  };
}


function TdsRecon({ onBack }) {
  const { user, selectedCompany, refreshCompanies, setSelectedCompany } = useAuth();
  const [companyId, setCompanyId] = useState(selectedCompany?.id || null);
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [visibleEvents, setVisibleEvents] = useState([]);
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState('summary');
  const [expandedSections, setExpandedSections] = useState(new Set());
  const [reviewDecisions, setReviewDecisions] = useState({});
  const [runCount, setRunCount] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState({ form26: null, tally: null });
  const [useUpload, setUseUpload] = useState(false);
  const firmName = user?.firm_name || user?.email?.split('@')[0] || 'your firm';
  const [chatMessages, setChatMessages] = useState([
    companyId
      ? { role: 'assistant', content: 'Welcome to TDS Reconciliation. I can help you reconcile Form 26 against Tally books.', actions: ['Run Reconciliation', 'Upload Files'] }
      : { role: 'assistant', content: `I see no client company registered for ${firmName}. Would you like to create one?\n\nYou can say **"yes"** and I\'ll ask for the details, or type something like **"create company HPC, PAN AAACH1234A"** directly.`, actions: ['Create Company'] },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState(null);
  const [questionAnswer, setQuestionAnswer] = useState({ selected: [], textInput: '' });
  const logRef = useRef(null);
  const chatEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const eventQueueRef = useRef([]);
  const drainTimerRef = useRef(null);
  const pipelineReceivedRef = useRef(false);

  // Sync companyId when selectedCompany changes (e.g. from company selector)
  useEffect(() => {
    if (selectedCompany?.id) setCompanyId(selectedCompany.id);
  }, [selectedCompany]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, visibleEvents]);


  // Drip-feed: reveal queued events one by one with delays
  const drainQueue = () => {
    if (drainTimerRef.current) return; // already draining
    console.log('[TDS] drainQueue started, queue length:', eventQueueRef.current.length);
    const next = () => {
      const item = eventQueueRef.current.shift();
      if (!item) { drainTimerRef.current = null; console.log('[TDS] drainQueue: queue empty, stopping'); return; }

      if (item._pipelineComplete) {
        console.log('[TDS] drainQueue: pipeline_complete reached. Setting done.');
        // Production backend sends: { summary: {...}, errors: [...], run_id: "..." }
        // Map to internal format for KPI cards and dashboard
        const runId = item._runId || item.run_id || null;
        setResults({ reconciliation_summary: item.summary || {}, run_id: runId });
        setRunCount(prev => prev + 1);
        setStatus('done');
        const s = item.summary;
        if (s) {
          const m = s.matching || {};
          const c = s.compliance || {};
          const hasStats = m.total_resolved || c.total_findings;
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: hasStats
              ? `Reconciliation complete!\n\n**${m.total_resolved || 0} entries resolved** (${m.matched_with_tds || 0} with TDS + ${m.below_threshold_resolved || 0} exempt)\n**${c.total_findings || 0} findings** (${c.errors || 0} errors, ${c.warnings || 0} warnings)\n**\u20B9${fmt(c.missing_tds_exposure || 0)}** missing TDS exposure\n\nWhat would you like to explore?`
              : `Reconciliation complete!${item.message ? ' ' + item.message : ''}\n\nWhat would you like to explore?`,
            actions: ['Show Summary', 'Show Matches', 'View Findings', 'Export Report'],
          }]);
        } else {
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `Reconciliation complete!${item.message ? ' ' + item.message : ''}`,
            actions: ['Show Summary', 'Export Report'],
          }]);
        }
        if (item.errors?.length > 0) {
          console.warn('[TDS] Pipeline completed with errors:', item.errors);
        }
        drainTimerRef.current = null;
        return;
      }

      console.log('[TDS] drainQueue: dripping event:', item.type, item.agent, '| remaining:', eventQueueRef.current.length);
      setVisibleEvents(prev => [...prev, item]);

      // If this is a question event, also set it as pending
      if (item.type === 'question') {
        setPendingQuestion(item);
      }

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

  // Create company via API and update state
  const createCompanyFromChat = async (name, pan) => {
    addAssistantMsg(`Creating company **${name}** (PAN: ${pan})...`);
    try {
      const result = await api.post(ENDPOINTS.companies, {
        company_name: name,
        pan: pan,
        company_type: 'company',
      });
      const comps = await refreshCompanies();
      if (comps?.length > 0) {
        const created = comps.find(c => c.pan === pan) || comps[0];
        setCompanyId(created.id);
        setSelectedCompany(created);
        addAssistantMsg(
          `Company **${created.company_name}** created successfully!\n\nNow you can upload Form 26 and Tally files, then run reconciliation.`,
          ['Upload Files', 'Run Reconciliation']
        );
      }
    } catch (err) {
      addAssistantMsg(`Failed to create company: ${err.message}. Please try again.`, ['Create Company']);
    }
  };

  // Handle chat commands
  const handleCommand = async (text) => {
    const lower = text.toLowerCase().trim();

    // Local actions that don't need LLM
    if (lower === 'retry') { runPipeline(); return; }

    // Company creation — interactive prompt
    if (lower === 'yes' || lower === 'create company' || lower === 'create' || lower.includes('let\'s create') || lower.includes('lets create')) {
      setPendingQuestion({
        type: 'question',
        agent: 'Lekha AI',
        question_id: 'create_company',
        message: 'Enter your client company details:',
        _isCompanyCreation: true,
      });
      addAssistantMsg('Please enter your client company details below:');
      return;
    }

    // Company creation — inline capture: "create company HPC, PAN AAACH1234A"
    const companyMatch = lower.match(/(?:create\s+company|company\s+name[:\s]+|add\s+company)\s+([^,]+?)(?:[,\s]+pan[:\s]*([a-z0-9]+))?$/i);
    if (companyMatch) {
      const name = text.match(/(?:create\s+company|company\s+name[:\s]+|add\s+company)\s+([^,]+?)(?:[,\s]+pan)?/i)?.[1]?.trim();
      const pan = text.match(/pan[:\s]*([A-Z0-9]+)/i)?.[1]?.trim() || 'PENDING';
      if (name) {
        createCompanyFromChat(name, pan);
        return;
      }
    }

    // Also handle direct name+PAN when question is pending
    if (pendingQuestion?._isCompanyCreation && !lower.includes('run') && !lower.includes('upload')) {
      const parts = text.split(/[,;]/);
      const name = parts[0]?.trim();
      const panPart = parts[1]?.trim() || '';
      const pan = panPart.replace(/^pan[:\s]*/i, '').trim() || 'PENDING';
      if (name && name.length > 1) {
        setPendingQuestion(null);
        createCompanyFromChat(name, pan);
        return;
      }
    }

    if ((lower.includes('run') || lower.includes('start') || lower.includes('reconcil')) && !lower.includes('why') && !lower.includes('explain')) {
      runPipeline();
      return;
    }
    if (lower.includes('upload')) { fileInputRef.current?.click(); return; }
    if (lower.includes('export') || lower === 'download') {
      setChatMessages(prev => [...prev, {
        role: 'download',
        files: [
          { name: 'tds_recon_report.xlsx', label: 'TDS Recon Report (Excel)' },
          { name: 'reconciliation_report.csv', label: 'Reconciliation Report (CSV)' },
          { name: 'findings_report.csv', label: 'Findings Report (CSV)' },
        ],
      }]);
      return;
    }

    // Everything else → send to real LLM chat agent
    setChatMessages(prev => [...prev, { role: 'assistant', content: null, _streaming: true }]);

    try {
      const res = await fetch(`${API_URL}${ENDPOINTS.chatStream}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getAuthToken() ? { 'Authorization': `Bearer ${getAuthToken()}` } : {}),
        },
        body: JSON.stringify({
          message: text,
          company_id: companyId || '',
          run_id: results?.run_id || '',
        }),
      });

      if (!res.ok) {
        throw new Error(`Chat API returned ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let toolCalls = [];
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'chat_token') {
                const content = event.content || '';
                // Detect tool call status lines (🔧 *tool_name*...)
                const toolMatch = content.match(/🔧\s*\*(\w+)\*\.\.\./)
                if (toolMatch) {
                  toolCalls.push(toolMatch[1]);
                  // Show tool call as a subtle status, not as response text
                  setChatMessages(prev => {
                    const updated = [...prev];
                    const idx = updated.findLastIndex(m => m._streaming);
                    if (idx >= 0) {
                      const toolStatus = toolCalls.map(t => `\u2022 Querying ${t.replace(/_/g, ' ')}...`).join('\n');
                      updated[idx] = { role: 'assistant', content: toolStatus, _streaming: true, _isTooling: true };
                    }
                    return updated;
                  });
                } else if (content.includes('Max tool calls reached')) {
                  // Ignore — this is an internal limit, not user-facing
                } else {
                  // Real response text
                  accumulated += content;
                  setChatMessages(prev => {
                    const updated = [...prev];
                    const idx = updated.findLastIndex(m => m._streaming);
                    if (idx >= 0) {
                      updated[idx] = { role: 'assistant', content: accumulated, _streaming: true };
                    }
                    return updated;
                  });
                }
              } else if (event.type === 'chat_done') {
                setChatMessages(prev => {
                  const updated = [...prev];
                  const idx = updated.findLastIndex(m => m._streaming);
                  if (idx >= 0) {
                    updated[idx] = { role: 'assistant', content: accumulated || 'Done.' };
                  }
                  return updated;
                });
              }
            } catch {}
          }
        }
      }

      // Stream ended — finalize message
      setChatMessages(prev => {
        const updated = [...prev];
        const idx = updated.findLastIndex(m => m._streaming);
        if (idx >= 0) {
          updated[idx] = { role: 'assistant', content: accumulated || 'No response.' };
        }
        return updated;
      });
    } catch (err) {
      setChatMessages(prev => {
        const updated = [...prev];
        const idx = updated.findLastIndex(m => m._streaming);
        if (idx >= 0) {
          updated[idx] = {
            role: 'assistant',
            content: 'Chat agent is not available. Use the action buttons below.',
            actions: ['Run Reconciliation', 'Upload Files'],
          };
        }
        return updated;
      });
    }
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

  // Submit answer to a pending question
  const submitAnswer = async () => {
    if (!pendingQuestion || questionAnswer.selected.length === 0) return;

    const answer = {
      question_id: pendingQuestion.question_id,
      selected: questionAnswer.selected.filter(s => s !== '_other'),
      text_input: questionAnswer.selected.includes('_other') ? questionAnswer.textInput : null,
    };

    // Show user's answer as a chat message
    const answerText = questionAnswer.selected.includes('_other')
      ? questionAnswer.textInput
      : questionAnswer.selected.map(id => pendingQuestion.options?.find(o => o.id === id)?.label || id).join(', ');
    setChatMessages(prev => [...prev, { role: 'user', content: answerText }]);

    // Mark question as answered
    setPendingQuestion(prev => prev ? { ...prev, _answered: true } : null);
    setQuestionAnswer({ selected: [], textInput: '' });

    // POST answer to backend
    try {
      await api.post(ENDPOINTS.answer, answer);
    } catch (err) {
      console.error('[TDS] Failed to submit answer:', err);
    }
  };

  // Upload files then run, or run on existing data
  const runPipeline = async () => {
    setStatus('running');
    setVisibleEvents([]);
    setReviewDecisions({});
    setResults(null);
    setPendingQuestion(null);
    setQuestionAnswer({ selected: [], textInput: '' });
    // Clear any pending drip-feed from previous run
    eventQueueRef.current = [];
    if (drainTimerRef.current) { clearTimeout(drainTimerRef.current); drainTimerRef.current = null; }
    pipelineReceivedRef.current = false;

    // Step 1: Upload files if provided
    if (uploadedFiles.form26 && uploadedFiles.tally) {
      addAssistantMsg('Uploading files...');
      try {
        const formData = new FormData();
        formData.append('form26', uploadedFiles.form26);
        formData.append('tally', uploadedFiles.tally);
        await api.post(ENDPOINTS.upload, formData);
        addAssistantMsg('Files uploaded. Parser will auto-detect company from file headers.');
      } catch (err) {
        setVisibleEvents([{ agent: 'Upload', type: 'error', message: `Upload failed: ${err.message}` }]);
        setStatus('error');
        return;
      }
    }

    // Step 2: Resolve company_id — refresh from backend after upload
    let activeCompanyId = companyId;
    if (!activeCompanyId) {
      try {
        const comps = await refreshCompanies();
        if (comps?.length > 0) {
          activeCompanyId = comps[0].id;
          setCompanyId(activeCompanyId);
          setSelectedCompany(comps[0]);
          console.log('[TDS] Auto-selected company after upload:', activeCompanyId, comps[0].company_name);
        }
      } catch {
        // ignore
      }
    }
    if (!activeCompanyId) {
      addAssistantMsg('No company found. Please upload Form 26 and Tally files first — the parser will auto-create the company.', ['Upload Files']);
      setStatus('idle');
      return;
    }

    addAssistantMsg('Starting reconciliation pipeline. Running agents: Parser \u2192 Matcher \u2192 TDS Checker \u2192 Reporter...');
    const fy = '2024-25';
    const streamUrl = `${ENDPOINTS.reconStream}?company_id=${activeCompanyId}&financial_year=${fy}`;

    try {
      console.log('[TDS] SSE opening:', streamUrl);
      let runId = null;

      // Use auth-aware SSE (fetch-based, supports Bearer token)
      const closeSSE = createAuthSSE(
        streamUrl,
        // onEvent — each SSE event
        (event) => {
          if (event.type === 'keepalive') return;
          console.log('[TDS] SSE event:', event.type, event.agent, '| queue size:', eventQueueRef.current.length);

          if (event.run_id) runId = event.run_id;

          if (event.type === 'pipeline_complete') {
            pipelineReceivedRef.current = true;
            closeSSE();
            // Store run_id for report fetches
            enqueueEvent({ ...event, _pipelineComplete: true, _runId: runId });
            return;
          }

          enqueueEvent(event);
        },
        // onError — connection lost or stream ended
        (err) => {
          console.warn('[TDS] SSE error:', err?.message, 'pipelineReceived:', pipelineReceivedRef.current);
          if (!pipelineReceivedRef.current) {
            // Retry with exponential backoff — fetch summary directly
            const retryFetch = async (retries = 3) => {
              for (let i = 0; i < retries; i++) {
                console.log(`[TDS] Retry attempt ${i + 1}/${retries}`);
                try {
                  if (runId) {
                    const data = await api.get(ENDPOINTS.reportSummary(runId));
                    setResults({ reconciliation_summary: data });
                  } else {
                    const data = await api.get(`${ENDPOINTS.reconRuns}?company_id=${activeCompanyId}`);
                    if (data?.length > 0) {
                      const latest = data[0];
                      const summary = await api.get(ENDPOINTS.reportSummary(latest.run_id));
                      setResults({ reconciliation_summary: summary });
                      runId = latest.run_id;
                    }
                  }
                  setRunCount(prev => prev + 1);
                  setStatus('done');
                  return;
                } catch {
                  if (i < retries - 1) await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000));
                }
              }
              setStatus('error');
              addAssistantMsg('Connection lost. The backend may have stopped.', ['Retry']);
            };
            retryFetch();
          }
        },
        // onOpen
        () => console.log('[TDS] SSE connected')
      );
    } catch (err) {
      setVisibleEvents([{ agent: 'Error', type: 'error', message: `Failed to connect: ${err.message}. Make sure the backend is running on port 8000.` }]);
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
      const data = await api.post('/api/review', { decisions });
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

  // ═══ RENDER ═══
  return (
    <div className="tds-recon">
      <button className="tds-back-link" onClick={onBack}>
        &larr; Back to Reconciliations
      </button>

      <div className="tds-header">
        <div className="tds-header-left">
          <h1>TDS Reconciliation (all sections)</h1>
          <div className="tds-subtitle">FY 2024-25 | AY 2025-26 | Sections: 194A, 194C, 194H, 194J(b), 194Q</div>
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

      <div className="tds-split">
        {/* ── LEFT: Dashboard ── */}
        <div className="tds-dashboard">
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
              {/* KPI Cards */}
              {summary && (() => {
                const m = summary.matching || {};
                const c = summary.compliance || {};
                // Real exposure = only missing TDS + wrong section/rate errors (not zero-rate exempt)
                const realExposure = (findings || [])
                  .filter(f => f.severity === 'error' && (f.check === 'missing_tds' || f.check === 'rate_validation' || f.check === 'section_validation'))
                  .reduce((sum, f) => sum + (f.aggregate_amount || f.form26_amount || 0), 0);
                const issuesTdsAmount = (findings || [])
                  .filter(f => f.severity === 'error' || f.severity === 'warning')
                  .reduce((sum, f) => sum + (f.aggregate_amount || f.form26_amount || 0), 0);
                return (
                <div className="tds-kpi-row">
                  <div className="tds-kpi-card">
                    <div className="tds-kpi-value">{m.form26_in_scope || 0}</div>
                    <div className="tds-kpi-label">Entries Analyzed</div>
                  </div>
                  <div className="tds-kpi-card">
                    <div className="tds-kpi-value">{m.total_resolved || 0}</div>
                    <div className="tds-kpi-label">
                      Reconciled ({m.matched_with_tds || 0} TDS + {m.below_threshold_resolved || 0} exempt)
                    </div>
                    <div className="tds-kpi-bar">
                      <div className="tds-kpi-bar-fill" style={{ width: `${m.match_rate_pct || 0}%` }} />
                    </div>
                  </div>
                  <div className="tds-kpi-card">
                    <div className="tds-kpi-value" style={{ fontSize: 22 }}>
                      {'\u20B9'}{fmt(summary.amounts?.matched_tds || 0)}
                    </div>
                    <div className="tds-kpi-label">Actual TDS Deducted</div>
                  </div>
                  <div className="tds-kpi-card">
                    <div className="tds-kpi-value" style={{ fontSize: 22, color: realExposure > 0 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                      {'\u20B9'}{fmt(realExposure)}
                    </div>
                    <div className="tds-kpi-label">
                      {realExposure > 0 ? 'TDS at Risk (missing/wrong)' : 'No TDS Risk'}
                    </div>
                  </div>
                </div>
                );
              })()}

              {/* Tabs */}
              <div className="tds-tabs">
                {['summary', 'tds_details', 'pending'].map(tab => (
                  <button
                    key={tab}
                    className={`tds-tab ${activeTab === tab ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab === 'summary' ? 'Section Summary' :
                     tab === 'tds_details' ? `TDS Details (${matches.length})` :
                     `Pending (${findings.filter(f => f.severity === 'error' || f.severity === 'warning').length})`}
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

        {/* ── RIGHT: Chat + Agent Activity ── */}
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
          {status === 'running' && (
            <div className="tds-agent-status-line">
              {(() => {
                const lastEvent = visibleEvents[visibleEvents.length - 1];
                if (!lastEvent) return <span className="tds-status-text">Starting pipeline...</span>;
                const isLlm = lastEvent.type === 'llm_call';
                return (
                  <span>
                    <span className="tds-status-agent">{isLlm ? '\uD83D\uDCAD' : '\u25D4'} {lastEvent.agent}</span>
                    <span className="tds-status-text"> {'\u2014'} {lastEvent.message?.slice(0, 80)}</span>
                  </span>
                );
              })()}
            </div>
          )}
          {status === 'done' && visibleEvents.length > 0 && (
            <div className="tds-agent-status-line done">
              <span>{'\u2713'} Complete {'\u2014'} 4 agents finished</span>
            </div>
          )}
          <div className="tds-chat-body" ref={logRef}>
            {/* Chat messages */}
            {chatMessages.map((msg, mi) => (
              <div key={`msg-${mi}`}>
                {msg.role === 'user' && (
                  <div className="tds-chat-user">
                    <div className="tds-chat-user-bubble">{msg.content}</div>
                  </div>
                )}
                {msg.role === 'assistant' && (
                  <div className="tds-chat-assistant">
                    <div className="tds-chat-avatar">L</div>
                    <div className="tds-chat-assistant-content">
                      {msg.content === null ? (
                        <div className="tds-chat-assistant-bubble">
                          <div className="tds-typing" style={{ margin: 0, padding: 0 }}>
                            <div className="tds-typing-dot" />
                            <div className="tds-typing-dot" />
                            <div className="tds-typing-dot" />
                          </div>
                        </div>
                      ) : (
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
                      )}
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
                          <a key={fi} className="tds-chat-download-link" href={`${API_URL}${ENDPOINTS.reportDownload(results?.run_id || '', f.name)}`} download={f.name}>
                            <span className="tds-chat-download-icon">{'\u2B07'}</span>
                            {f.label}
                          </a>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Render agent blocks after the "Starting pipeline" assistant message */}
                {mi === chatMessages.findLastIndex(m => m.content?.includes('Starting reconciliation')) && eventBlocks.length > 0 && (
                  <div className="tds-chat-agent-blocks">
                    {eventBlocks.map((block, bi) => {
                      const isDone = block.events.some(e => e.type === 'agent_done');
                      const isActive = !isDone && !block.standalone && status === 'running';

                      return (
                        <div key={bi} className={`tds-agent-block ${isActive ? 'active' : ''}`}>
                          <div className="tds-agent-header">
                            <div className={`tds-agent-icon ${getAgentIconClass(block.agent)}`}>
                              {getAgentIconLetter(block.agent)}
                            </div>
                            <span className="tds-agent-name">{block.agent}</span>
                            {isActive && pendingQuestion?.agent === block.agent && !pendingQuestion._answered && (
                              <span className="tds-agent-status-badge waiting">Waiting for input</span>
                            )}
                            {isActive && !(pendingQuestion?.agent === block.agent && !pendingQuestion._answered) && (
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
                          {isActive && (
                            <div className="tds-agent-thinking">
                              <div className="tds-agent-thinking-dot" />
                              <span className="tds-thinking-text">Processing...</span>
                            </div>
                          )}

                          {/* Detail log lines + LLM events */}
                          {block.events
                            .filter(e => e.type !== 'agent_start' && e.type !== 'agent_done')
                            .map((e, ei) => (
                              e.type === 'llm_call' ? (
                                <div key={ei} className="tds-log-line llm_call" style={{ animationDelay: `${ei * 0.05}s` }}>
                                  <span className="log-prefix">{'\uD83D\uDCAD'}</span>
                                  <span className="tds-llm-label">Asking AI...</span> {e.message}
                                  {e.data?.model && <span className="tds-llm-model">{e.data.model}</span>}
                                </div>
                              ) : e.type === 'llm_response' ? (
                                <div key={ei} className="tds-log-line llm_response" style={{ animationDelay: `${ei * 0.05}s` }}>
                                  <span className="log-prefix">{'\u2726'}</span>
                                  {e.message}
                                  {e.data?.response_time_s && <span className="tds-llm-time">{e.data.response_time_s.toFixed(1)}s</span>}
                                </div>
                              ) : e.type === 'llm_insight' ? (
                                <div key={ei} className="tds-insight-card" style={{ animationDelay: `${ei * 0.05}s` }}>
                                  <span className="tds-insight-icon">{'\uD83D\uDD0D'}</span>
                                  <div className="tds-insight-content">{e.message}</div>
                                </div>
                              ) : e.type === 'human_needed' ? (
                                <div key={ei} className="tds-human-needed" style={{ animationDelay: `${ei * 0.05}s` }}>
                                  <span className="tds-human-icon">{'\uD83D\uDC64'}</span>
                                  <div className="tds-human-content">{e.message}</div>
                                </div>
                              ) : (
                                <div key={ei} className={`tds-log-line ${e.type}`} style={{ animationDelay: `${ei * 0.05}s` }}>
                                  <span className="log-prefix">
                                    {e.type === 'detail' ? '\u251C\u2500' : e.type === 'success' ? '\u2713' : e.type === 'error' ? '\u2717' : e.type === 'warning' ? '\u26A0' : '\u2022'}
                                  </span>
                                  {e.message}
                                </div>
                              )
                            ))}

                          {/* Interactive question from agent — Column Confirmation or Standard */}
                          {pendingQuestion && pendingQuestion.agent === block.agent && !pendingQuestion._answered && (
                            <div className="tds-question-block">
                              <div className="tds-question-header">
                                <span className="tds-question-icon">?</span>
                                <span className="tds-question-agent">{block.agent} needs your input</span>
                              </div>
                              <div className="tds-question-text">{pendingQuestion.message}</div>

                              {/* Column Confirmation Table — rendered when column_confirmation data is in events */}
                              {(() => {
                                const colConfEvent = block.events.find(e => e.data?.type === 'column_confirmation');
                                if (colConfEvent?.data?.files) {
                                  return (
                                    <div className="tds-column-confirm">
                                      {colConfEvent.data.files.map((file, fi) => (
                                        <div key={fi} className="tds-col-file-section">
                                          <div className="tds-col-file-header">
                                            <strong>{file.file_type === 'tds' ? 'Form 26' : 'Tally'}</strong>
                                            <span style={{ opacity: 0.6, marginLeft: 8 }}>{file.sheet_name} ({file.total_rows} rows)</span>
                                            {file.expense_head_columns > 0 && (
                                              <span style={{ opacity: 0.5, marginLeft: 8, fontSize: 11 }}>
                                                + {file.expense_head_columns} expense heads, {file.gst_columns || 0} GST cols
                                              </span>
                                            )}
                                          </div>
                                          <table className="tds-col-table">
                                            <thead>
                                              <tr>
                                                <th>Col</th>
                                                <th>File Column</th>
                                                <th>Mapped To</th>
                                                <th>Confidence</th>
                                                <th>Samples</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {file.columns.map((col, ci) => (
                                                <tr key={ci} className={col.tier === 'HIGH' ? '' : col.tier === 'MEDIUM' ? 'tds-col-medium' : 'tds-col-low'}>
                                                  <td style={{ opacity: 0.5 }}>{col.col_index + 1}</td>
                                                  <td>{col.source_name}</td>
                                                  <td>
                                                    <select
                                                      value={col.mapped_to || ''}
                                                      onChange={(e) => {
                                                        // Update mapping in the event data (for submission)
                                                        const newTarget = e.target.value;
                                                        col.mapped_to = newTarget;
                                                      }}
                                                      className="tds-col-select"
                                                    >
                                                      <option value={col.mapped_to}>{col.mapped_to}</option>
                                                      {(col.alternatives || []).map(alt => (
                                                        <option key={alt} value={alt}>{alt}</option>
                                                      ))}
                                                      <option value="skip">skip</option>
                                                    </select>
                                                  </td>
                                                  <td>
                                                    <span className={`tds-conf-badge ${col.tier === 'HIGH' ? 'high' : col.tier === 'MEDIUM' ? 'medium' : 'low'}`}>
                                                      {Math.round(col.confidence * 100)}%
                                                    </span>
                                                  </td>
                                                  <td style={{ fontSize: 11, opacity: 0.6, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {(col.sample_values || []).join(', ')}
                                                  </td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                }
                                return null;
                              })()}

                              {/* Standard question options */}
                              <div className="tds-question-options">
                                {pendingQuestion.options?.map((opt) => (
                                  <button
                                    key={opt.id}
                                    className={`tds-question-option ${questionAnswer.selected.includes(opt.id) ? 'selected' : ''}`}
                                    onClick={() => {
                                      if (pendingQuestion.multi_select) {
                                        setQuestionAnswer(prev => ({
                                          ...prev,
                                          selected: prev.selected.includes(opt.id)
                                            ? prev.selected.filter(s => s !== opt.id)
                                            : [...prev.selected, opt.id]
                                        }));
                                      } else {
                                        setQuestionAnswer(prev => ({ ...prev, selected: [opt.id] }));
                                      }
                                    }}
                                  >
                                    <div className="tds-option-radio">{questionAnswer.selected.includes(opt.id) ? '\u25CF' : '\u25CB'}</div>
                                    <div className="tds-option-content">
                                      <div className="tds-option-label">{opt.label}</div>
                                      {opt.description && <div className="tds-option-desc">{opt.description}</div>}
                                    </div>
                                  </button>
                                ))}
                              </div>
                              <button
                                className="tds-question-submit"
                                disabled={questionAnswer.selected.length === 0}
                                onClick={submitAnswer}
                              >
                                {block.events.some(e => e.data?.type === 'column_confirmation') ? 'Confirm Columns & Parse' : 'Submit Decision'}
                              </button>
                            </div>
                          )}

                          {/* Completion action chips */}
                          {isDone && (
                            <div className="tds-agent-actions">
                              {block.agent.includes('Parser') && <button className="tds-chat-action-chip small" onClick={() => handleActionClick('Show Summary')}>Show Summary</button>}
                              {block.agent.includes('Matcher') && <button className="tds-chat-action-chip small" onClick={() => handleActionClick('Show Matches')}>Show Matches</button>}
                              {block.agent.includes('Checker') && <button className="tds-chat-action-chip small" onClick={() => handleActionClick('View Findings')}>View Findings</button>}
                              {block.agent.includes('Reporter') && <button className="tds-chat-action-chip small" onClick={() => handleActionClick('Export Report')}>Export Report</button>}
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
            ))}
            {/* Company creation form — shown in chat when no company exists */}
            {pendingQuestion?._isCompanyCreation && !pendingQuestion._answered && (
              <div className="tds-chat-assistant">
                <div className="tds-chat-avatar">L</div>
                <div className="tds-chat-assistant-content">
                  <div className="tds-question-block" style={{ margin: 0 }}>
                    <div className="tds-question-header">
                      <span className="tds-question-icon">?</span>
                      <span className="tds-question-agent">New Client Company</span>
                    </div>
                    <div className="tds-question-text">Enter company details to get started</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input
                        className="tds-question-text-input"
                        type="text"
                        placeholder="Company name (e.g. HPC Pvt Ltd)"
                        value={questionAnswer.textInput || ''}
                        onChange={e => setQuestionAnswer(prev => ({ ...prev, textInput: e.target.value }))}
                        style={{ marginBottom: 0 }}
                        autoFocus
                      />
                      <input
                        className="tds-question-text-input"
                        type="text"
                        placeholder="PAN (e.g. AAACH1234A)"
                        value={questionAnswer.selected[0] || ''}
                        onChange={e => setQuestionAnswer(prev => ({ ...prev, selected: [e.target.value] }))}
                        style={{ marginBottom: 0 }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && questionAnswer.textInput) {
                            setPendingQuestion(prev => prev ? { ...prev, _answered: true } : null);
                            const name = questionAnswer.textInput.trim();
                            const pan = (questionAnswer.selected[0] || 'PENDING').trim();
                            setQuestionAnswer({ selected: [], textInput: '' });
                            setChatMessages(prev => [...prev, { role: 'user', content: `${name}, PAN ${pan}` }]);
                            createCompanyFromChat(name, pan);
                          }
                        }}
                      />
                    </div>
                    <button
                      className="tds-question-submit"
                      style={{ marginTop: 8 }}
                      disabled={!questionAnswer.textInput?.trim()}
                      onClick={() => {
                        setPendingQuestion(prev => prev ? { ...prev, _answered: true } : null);
                        const name = questionAnswer.textInput.trim();
                        const pan = (questionAnswer.selected[0] || 'PENDING').trim();
                        setQuestionAnswer({ selected: [], textInput: '' });
                        setChatMessages(prev => [...prev, { role: 'user', content: `${name}, PAN ${pan}` }]);
                        createCompanyFromChat(name, pan);
                      }}
                    >
                      Create Company
                    </button>
                  </div>
                </div>
              </div>
            )}
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
      </div>
    </div>
  );
}

export default TdsRecon;
