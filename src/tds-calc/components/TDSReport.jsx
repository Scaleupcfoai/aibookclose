import { useEffect, useState } from 'react';
import { formatINR } from '../lib/format.js';
import { apiJson } from '../lib/api.js';

const TABS = [
  { id: 'party', label: 'By Party' },
  { id: 'section', label: 'By Section' },
  { id: 'quarter', label: 'By Quarter' },
];

export default function TDSReport({ sessionId }) {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState('party');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    apiJson(`/api/session/${sessionId}/results`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [sessionId]);

  if (error) return <div className="report-error">Failed to load results: {error}</div>;
  if (!data) return <div className="report-loading">Loading results…</div>;

  const { totals, party_view, section_view, quarter_view, flags } = data;

  return (
    <div className="report">
      <div className="report-header">
        <div>
          <div className="report-title">TDS summary</div>
          <div className="report-sub">
            {totals.row_count} rows · {party_view.length} vendors · {section_view.length} sections
          </div>
        </div>
        <div className="report-total">
          <div className="report-total-label">Total TDS</div>
          <div className="report-total-value">{formatINR(totals.total_tds)}</div>
          <a
            className="btn-primary report-download"
            href={`/api/session/${sessionId}/report.xlsx`}
            download
          >
            Download Excel
          </a>
        </div>
      </div>

      {flags.length > 0 && (
        <div className="report-warning">
          {flags.length} flagged {flags.length === 1 ? 'row' : 'rows'} not yet resolved.
          Those are excluded from the TDS totals until you confirm.
        </div>
      )}

      <div className="report-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`report-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'party' && <PartyTable rows={party_view} />}
      {activeTab === 'section' && <SectionTable rows={section_view} />}
      {activeTab === 'quarter' && <QuarterTable rows={quarter_view} />}
    </div>
  );
}

function PartyTable({ rows }) {
  if (!rows.length) return <div className="report-empty">No rows.</div>;
  return (
    <div className="report-table">
      <div className="report-row head">
        <div className="col-vendor">Vendor</div>
        <div className="col-pan">PAN</div>
        <div className="col-num">Amount paid</div>
        <div className="col-num">TDS</div>
        <div className="col-tags">Sections</div>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="report-row">
          <div className="col-vendor">{r.vendor || '—'}</div>
          <div className="col-pan font-mono">{r.pan || '—'}</div>
          <div className="col-num">{formatINR(r.total_paid)}</div>
          <div className="col-num num-accent">{formatINR(r.total_tds)}</div>
          <div className="col-tags">
            {(r.sections || []).map((s) => (
              <span key={s} className="section-tag">{s}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionTable({ rows }) {
  if (!rows.length) return <div className="report-empty">No rows.</div>;
  return (
    <div className="report-table">
      <div className="report-row head">
        <div className="col-section">Section</div>
        <div className="col-num">Base amount</div>
        <div className="col-num">TDS</div>
        <div className="col-num">Rows</div>
        <div className="col-num">Vendors</div>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="report-row">
          <div className="col-section"><span className="section-tag">{r.section}</span></div>
          <div className="col-num">{formatINR(r.total_base)}</div>
          <div className="col-num num-accent">{formatINR(r.total_tds)}</div>
          <div className="col-num">{r.row_count}</div>
          <div className="col-num">{r.vendor_count}</div>
        </div>
      ))}
    </div>
  );
}

function QuarterTable({ rows }) {
  if (!rows.length) {
    return <div className="report-empty">Quarter view needs a Date column mapped.</div>;
  }
  return (
    <div className="report-table">
      <div className="report-row head">
        <div className="col-quarter">Period</div>
        <div className="col-num">TDS</div>
        <div className="col-num">Rows</div>
        <div className="col-due">Deposit due</div>
      </div>
      {rows.map((r, i) => (
        <div key={i} className="report-row">
          <div className="col-quarter"><strong>{r.fy}</strong> · {r.quarter}</div>
          <div className="col-num num-accent">{formatINR(r.total_tds)}</div>
          <div className="col-num">{r.row_count}</div>
          <div className="col-due font-mono">{(r.deposit_due_dates || []).join(', ')}</div>
        </div>
      ))}
    </div>
  );
}
