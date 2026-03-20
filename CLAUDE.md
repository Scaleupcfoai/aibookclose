# CLAUDE.md — Lekha AI Book Close

> **Read CHANGELOG.md first** before making any changes. It contains the current version, recent changes, and known issues.

## Project Identity

- **Product:** Lekha AI — AI-Powered Book Close Management
- **Owner:** Ashish (Founder, not a full-time engineer)
- **Stage:** Early product demo, optimizing for demo-ready thin slices over perfect architecture
- **Stack:** React 19 + Vite 7 (frontend only, mock data, no backend yet)
- **Location:** `C:\Users\Ashish\book-close-demo`
- **Dev Server:** `npm run dev` → http://localhost:5175/
- **Preview Config:** `.claude/launch.json` → name: "book-close" (uses cmd.exe workaround for Google Drive path)

## Repo Structure

```
book-close-demo/
├── CLAUDE.md              ← You are here. Project identity & conventions.
├── CHANGELOG.md           ← Version log. READ THIS FIRST every session.
├── .claude/
│   └── commands/
│       └── finish.md      ← Run /finish at end of every session.
├── index.html             ← Entry point, title & favicon
├── package.json           ← Dependencies (React, Vite)
├── vite.config.js         ← Vite config
├── public/
│   └── lekha-logo.svg     ← Custom logo (book + arrow + checkmarks)
└── src/
    ├── main.jsx           ← React entry point
    ├── App.jsx            ← ALL UI logic (single-file app, ~550 lines)
    ├── index.css          ← ALL styles (~700 lines)
    ├── App.css            ← Empty (styles in index.css)
    └── data/
        └── mockData.js    ← All mock data (team, tasks, recons, JEs, TB, flux)
```

## Application Architecture

### 3-Panel Layout
- **Left Panel:** Brand, close period card, navigation (6 views), team members, AI assistant button
- **Center Panel:** Main content area (switches between 6 views)
- **Right Panel:** Detail slider (task detail, recon detail, JE detail)

### 6 Views
1. **Dashboard** — Progress stats, phase grid, activity feed, blockers
2. **Checklist** — 47 tasks across 7 phases (accordion), status toggles, owner/reviewer
3. **Reconciliations** — 9 accounts as cards, GL vs Supporting balance, reconciling items
4. **Journal Entries** — 10 AJEs with 4-stage workflow (Not Started → Draft → Review → Posted)
5. **Trial Balance** — Full chart of accounts, Unadjusted/Adjusted toggle, balance check
6. **Financial Statements** — P&L + Balance Sheet tabs, Flux Analysis table

### 7 Close Phases
1. Pre-Close → 2. Sub-Ledger Close → 3. Reconciliations → 4. Adjusting Entries → 5. Review & Analysis → 6. Financial Statements → 7. Close & Archive

### Mock Data Context
- Company: Prism Apparels Pvt. Ltd. (Indian apparel company, ~₹14 Cr turnover)
- Period: March 2026, FY 2025-26 (Year-End close)
- Team: 6 members (Controller, Senior Accountant, Staff Accountant, AP/AR Clerk, Payroll, CFO)
- 47 checklist tasks, 9 reconciliations, 10 journal entries, ~70 GL accounts

## Session Protocol

1. **Start of session:** Read `CHANGELOG.md` to know current version and recent context.
2. **Before writing code:** State a short plan (3-6 bullets) for what you'll change.
3. **After meaningful work:** Run `/finish` to update the changelog.
4. **Always:** Test changes in browser preview before marking complete.

## Code Conventions

- **Single-file UI:** All React logic in `App.jsx`, all styles in `index.css`. No component splitting until complexity demands it.
- **State management:** React useState only. No external state libraries.
- **Formatting:** Indian number format (₹ Cr / L). Use `fmt()` and `fmtFull()` helpers.
- **Dark theme:** GitHub-dark color palette. All colors via CSS variables in `:root`.
- **Mock data:** All data in `src/data/mockData.js`. No API calls yet.

## Competitors

- **FloQast** — Mid-market close management, Excel-centric
- **BlackLine** — Enterprise financial close, high-volume
- **Numeric** — AI-native close, strong flux analysis
- **Stacks.ai** — Agentic AI for reconciliation
- **Ledge** — High-volume recon for fintech/SaaS
- **Bluebook** — AI agents for accounting firms

## Related Projects

- **Lekha AI v1 (Payment Recon):** `C:\Users\Ashish\recon-demo` → https://github.com/Scaleupcfoai/aitdsrecon
- **Lekha AI v2 (TDS Recon):** Planned, not yet built

## What NOT To Do

- Don't split into multiple component files unless explicitly asked.
- Don't add backend/API calls — this is a frontend demo with mock data.
- Don't change the dark theme or color palette without permission.
- Don't remove mock data — it demonstrates the product to investors/developers.
