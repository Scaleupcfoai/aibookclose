// Reconciliation tile data and utilities for Lekha AI Book Close

// ─── Types (for reference — this is JS, not TS) ───
// ReconDomain: "TDS" | "GST" | "BANK" | "PLATFORM" | "CREDIT_CARD" | "EXPENSE" | "PAYROLL" | "INTERCOMPANY" | "ACCRUAL"
// StatusType: "Done" | "In Progress" | "Not Started" | "Blocked"

// ─── Domain badge colours ───
export const DOMAIN_COLORS = {
  BANK:         { bg: '#DBEAFE', text: '#1D4ED8' },
  TDS:          { bg: '#FFEDD5', text: '#C2410C' },
  GST:          { bg: '#FEF3C7', text: '#B45309' },
  PLATFORM:     { bg: '#EDE9FE', text: '#6D28D9' },
  CREDIT_CARD:  { bg: '#CFFAFE', text: '#0E7490' },
  EXPENSE:      { bg: '#D1FAE5', text: '#065F46' },
  PAYROLL:      { bg: '#DCFCE7', text: '#15803D' },
  INTERCOMPANY: { bg: '#E0E7FF', text: '#3730A3' },
  ACCRUAL:      { bg: '#F3F4F6', text: '#374151' },
};

// ─── Status badge colours ───
export const STATUS_COLORS = {
  'Done':        { bg: '#D1FAE5', text: '#065F46' },
  'In Progress': { bg: '#DBEAFE', text: '#1E40AF' },
  'Not Started': { bg: '#F3F4F6', text: '#6B7280' },
  'Blocked':     { bg: '#FEE2E2', text: '#991B1B' },
};

// ─── Assignee data ───
export const ASSIGNEES = {
  AM: { name: 'Ashish Mehta',   role: 'Controller',        bg: '#7C3AED' },
  PS: { name: 'Priya Sharma',   role: 'Sr. Accountant',    bg: '#DB2777' },
  RV: { name: 'Rahul Verma',    role: 'Staff Accountant',  bg: '#059669' },
  SP: { name: 'Sneha Patel',    role: 'AP/AR Clerk',       bg: '#D97706' },
  VS: { name: 'Vikram Singh',   role: 'Payroll',           bg: '#2563EB' },
  NG: { name: 'Neha Gupta',     role: 'CFO',               bg: '#DC2626' },
};

// ─── Indian number formatting ───
export function formatINR(value) {
  if (value == null) return '—';
  const isNeg = value < 0;
  const abs = Math.abs(value);
  const [intPart, decPart] = abs.toFixed(2).split('.');

  // Indian grouping: last 3, then groups of 2
  let result = '';
  const digits = intPart.split('');
  const len = digits.length;
  if (len <= 3) {
    result = intPart;
  } else {
    result = digits.slice(len - 3).join('');
    let remaining = digits.slice(0, len - 3);
    while (remaining.length > 0) {
      const group = remaining.splice(-2).join('');
      result = group + ',' + result;
    }
  }
  return (isNeg ? '-' : '') + '₹' + result + '.' + decPart;
}

// ─── Due date urgency ───
export function getDueDateColor(dueDateStr) {
  if (!dueDateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due - today) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { color: '#DC2626', bold: true };   // Past due
  if (diffDays <= 5) return { color: '#F97316', bold: false };  // ≤5 days
  return { color: '#6B7280', bold: false };                     // >5 days
}

// ─── Domain label for filter pills ───
export const DOMAIN_FILTER_LABELS = {
  ALL: 'All Domains',
  TDS: 'TDS',
  GST: 'GST',
  BANK: 'Banking',
  PLATFORM: 'Platform',
  CREDIT_CARD: 'Credit Card',
  EXPENSE: 'Expense',
  PAYROLL: 'Payroll',
  INTERCOMPANY: 'Intercompany',
  ACCRUAL: 'Balance Sheet',
};

// ─── 15 Reconciliation tiles ───
export const reconTiles = [
  {
    id: "tds-26q",
    domain: "TDS",
    title: "TDS — 26Q vs Books (Vendor Payments)",
    recon_type: "Return vs Books",
    compliance: "Regulatory",
    flow: "Expense",
    source_a_label: "TDS Deducted (Books)",
    source_a_value: 384250.00,
    source_b_label: "26Q Filed (TRACES)",
    source_b_value: 371500.00,
    status: "In Progress",
    assignee: "RV",
    items_open: 8,
    due_date: "2026-05-15",
    regulatory_note: "Q4 FY25-26 · Due May 15",
  },
  {
    id: "tds-24q",
    domain: "TDS",
    title: "TDS — 24Q vs Books (Salary)",
    recon_type: "Return vs Books",
    compliance: "Regulatory",
    flow: "Expense",
    source_a_label: "TDS Deducted (Payroll Register)",
    source_a_value: 214800.00,
    source_b_label: "24Q Filed (TRACES)",
    source_b_value: 214800.00,
    status: "Done",
    assignee: "VS",
    items_open: 0,
    due_date: "2026-05-15",
    regulatory_note: "Q4 FY25-26 · Due May 15",
  },
  {
    id: "gst-itc",
    domain: "GST",
    title: "GST ITC Recon — GSTR-2B vs Purchase Register",
    recon_type: "Statement vs Books",
    compliance: "Regulatory",
    flow: "Expense",
    source_a_label: "ITC as per Books",
    source_a_value: 312450.00,
    source_b_label: "ITC as per GSTR-2B (Portal)",
    source_b_value: 298600.00,
    status: "In Progress",
    assignee: "PS",
    items_open: 14,
    due_date: "2026-04-20",
    regulatory_note: "GSTR-3B due Apr 20 · ITC at risk",
  },
  {
    id: "gst-output",
    domain: "GST",
    title: "GST Output Recon — GSTR-1 vs Sales Register",
    recon_type: "Return vs Books",
    compliance: "Regulatory",
    flow: "Revenue",
    source_a_label: "Sales as per Books",
    source_a_value: 1845000.00,
    source_b_label: "Sales as per GSTR-1 Filed",
    source_b_value: 1832500.00,
    status: "Not Started",
    assignee: "RV",
    items_open: 0,
    due_date: "2026-04-11",
    regulatory_note: "GSTR-1 due Apr 11 · Past due",
  },
  {
    id: "gst-liability",
    domain: "GST",
    title: "GST Liability Recon — GSTR-1 vs GSTR-3B",
    recon_type: "Return vs Return",
    compliance: "Regulatory",
    flow: "Revenue",
    source_a_label: "Tax Liability (GSTR-1)",
    source_a_value: 421380.00,
    source_b_label: "Tax Paid (GSTR-3B)",
    source_b_value: 421380.00,
    status: "Not Started",
    assignee: "PS",
    items_open: 0,
    due_date: "2026-04-20",
    regulatory_note: "Complete after GSTR-1 is filed",
  },
  {
    id: "platform-sales-cash",
    domain: "PLATFORM",
    title: "Sales-to-Cash — Platform Settlements",
    recon_type: "Statement vs Books",
    compliance: "Internal Control",
    flow: "Revenue",
    source_a_label: "AR as per Books",
    source_a_value: 4280000.00,
    source_b_label: "Net Settlement Received",
    source_b_value: 4195600.00,
    status: "In Progress",
    assignee: "AM",
    items_open: 23,
    due_date: null,
    regulatory_note: null,
  },
  {
    id: "platform-merchant-fees",
    domain: "PLATFORM",
    title: "Platform & Merchant Fee Recon",
    recon_type: "Statement vs Books",
    compliance: "Internal Control",
    flow: "Expense",
    source_a_label: "Fees as per Books",
    source_a_value: 187500.00,
    source_b_label: "Fees per Settlement Report",
    source_b_value: 194320.00,
    status: "In Progress",
    assignee: "RV",
    items_open: 5,
    due_date: null,
    regulatory_note: null,
  },
  {
    id: "bank-hdfc",
    domain: "BANK",
    title: "HDFC Current A/c — Bank Recon (001-234567)",
    recon_type: "Statement vs Books",
    compliance: "Internal Control",
    flow: "Balance Sheet",
    source_a_label: "GL Balance",
    source_a_value: 2847562.50,
    source_b_label: "Bank Statement",
    source_b_value: 2892341.00,
    status: "In Progress",
    assignee: "RV",
    items_open: 6,
    due_date: null,
    regulatory_note: null,
  },
  {
    id: "bank-icici",
    domain: "BANK",
    title: "ICICI Savings A/c — Bank Recon (045-789012)",
    recon_type: "Statement vs Books",
    compliance: "Internal Control",
    flow: "Balance Sheet",
    source_a_label: "GL Balance",
    source_a_value: 548230.00,
    source_b_label: "Bank Statement",
    source_b_value: 548230.00,
    status: "Done",
    assignee: "RV",
    items_open: 0,
    due_date: null,
    regulatory_note: null,
  },
  {
    id: "bank-payments",
    domain: "BANK",
    title: "Bank Payments Recon — Outward Payments vs GL",
    recon_type: "Statement vs Books",
    compliance: "Internal Control",
    flow: "Expense",
    source_a_label: "Payments as per GL",
    source_a_value: 6732100.00,
    source_b_label: "Bank Debits (Statement)",
    source_b_value: 6714850.00,
    status: "Not Started",
    assignee: "RV",
    items_open: 0,
    due_date: null,
    regulatory_note: null,
  },
  {
    id: "credit-card-amex",
    domain: "CREDIT_CARD",
    title: "Amex Corporate Card — Statement vs Books",
    recon_type: "Statement vs Books",
    compliance: "Internal Control",
    flow: "Expense",
    source_a_label: "GL Balance (Card Payable)",
    source_a_value: 187450.00,
    source_b_label: "Card Statement",
    source_b_value: 194320.00,
    status: "In Progress",
    assignee: "RV",
    items_open: 2,
    due_date: null,
    regulatory_note: null,
  },
  {
    id: "prepaid-expenses",
    domain: "EXPENSE",
    title: "Prepaid Expenses — Amortisation Schedule vs GL",
    recon_type: "Schedule vs GL",
    compliance: "Internal Control",
    flow: "Expense",
    source_a_label: "Schedule Balance",
    source_a_value: 310200.00,
    source_b_label: "GL Balance",
    source_b_value: 324500.00,
    status: "In Progress",
    assignee: "RV",
    items_open: 1,
    due_date: null,
    regulatory_note: null,
  },
  {
    id: "intercompany-prism",
    domain: "INTERCOMPANY",
    title: "Intercompany — Prism Exports Ltd.",
    recon_type: "Entity vs Entity",
    compliance: "Internal Control",
    flow: "Balance Sheet",
    source_a_label: "Receivable (Our Books)",
    source_a_value: 1320000.00,
    source_b_label: "Payable (Prism Exports)",
    source_b_value: 1245000.00,
    status: "In Progress",
    assignee: "PS",
    items_open: 2,
    due_date: null,
    regulatory_note: null,
  },
  {
    id: "accrued-liabilities",
    domain: "ACCRUAL",
    title: "Accrued Liabilities — Schedule vs GL",
    recon_type: "Schedule vs GL",
    compliance: "Internal Control",
    flow: "Balance Sheet",
    source_a_label: "Accruals Schedule",
    source_a_value: null,
    source_b_label: "GL Balance",
    source_b_value: null,
    status: "Not Started",
    assignee: "PS",
    items_open: 0,
    due_date: null,
    regulatory_note: null,
  },
  {
    id: "payroll-recon",
    domain: "PAYROLL",
    title: "Payroll Recon — Salary Register vs GL",
    recon_type: "Register vs GL",
    compliance: "Internal Control",
    flow: "Expense",
    source_a_label: "Payroll Register (Gross)",
    source_a_value: null,
    source_b_label: "GL + Bank Payments",
    source_b_value: null,
    status: "Not Started",
    assignee: "VS",
    items_open: 0,
    due_date: null,
    regulatory_note: null,
  },
];
