# CHANGELOG — Lekha AI Book Close

> This file is Claude Code's "memory" across sessions. Read it at the start. Update it at the end.

## Current State

- **Version:** 0.1.0
- **Status:** Initial demo complete — 6 views working with mock data
- **Last session:** 2026-03-19
- **Next priority:** Refine UI based on feedback, add interactivity (AI suggestions, auto-post JEs, resolve recon items)

## Unreleased

_Changes since last tagged version. Move to a version block when you tag a release._

### Added
- (nothing yet)

### Changed
- (nothing yet)

### Fixed
- (nothing yet)

### Known Issues
- Trial Balance shows "Imbalanced" on unadjusted view (expected — revenue/expense accounts don't balance against equity until closing entries)
- Flux Analysis flags are based on simple % threshold — needs smarter logic
- AI Assistant panel is static (suggestions don't trigger actions yet)
- Balance Sheet two-column layout clips on narrow screens

---

## Version History

### 0.1.0 — Initial Book Close Demo (2026-03-19)

- Full 3-panel layout (nav + main + detail slider)
- Dashboard with progress stats, phase grid, activity feed, blockers
- Close Checklist: 47 tasks across 7 phases with accordion, status toggles, owners
- Reconciliations: 9 accounts (bank, credit card, intercompany, prepaid, tax, debt) with detail panel showing reconciling items
- Journal Entries: 10 AJEs with 4-stage workflow and detail panel showing debit/credit lines
- Trial Balance: Full chart of accounts with Unadjusted/Adjusted toggle
- Financial Statements: P&L and Balance Sheet with Flux Analysis
- AI Assistant modal with contextual insights
- 6 team members with role-based task assignments
- Mock data: Prism Apparels Pvt. Ltd., FY 2025-26 year-end close

---

## Session Log

_Brief log of what was done each session. Most recent first._

| Date | Session Summary | Files Touched | Version After |
|------|----------------|---------------|---------------|
| 2026-03-19 | Built complete book close demo with 6 views, 47 tasks, 9 recons, 10 JEs, TB, and financial statements | App.jsx, index.css, mockData.js, index.html, package.json | 0.1.0 |

---

## Versioning Rules

- **PATCH (0.0.x):** Bug fixes, style tweaks, data corrections
- **MINOR (0.x.0):** New view, new feature, new interactivity
- **MAJOR (x.0.0):** Backend integration, real data, multi-user auth

## How To Update This File

1. Add your changes under `## Unreleased` in the right category.
2. Add a row to the Session Log table.
3. Update `Current State` at the top (version, status, next priority).
4. When tagging a release: move Unreleased items into a new version block.
