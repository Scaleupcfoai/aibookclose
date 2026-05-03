# TDS Calculator + Recon Integration — Technical Handover Note

**Author:** Working notes for handover to technical reviewer
**Date:** 2026-05-03
**Branch under review:** `claude/integrate-tds-calculator-YruaY` (both repos)

---

## 1. Goal of the integration

Merge two previously-separate Lekha demos into a single dev experience:

1. **Lekha TDS Calculator** (was its own React + FastAPI app at `lekha-tds-calculator`)
2. **Lekha v1 Payment Recon / TDS 26Q Recon** (frontend was `aibookclose`, backend was `aitdsrecon` containing `tds-recon` + `gst` agents)

Target end-state:
- One frontend repo (`aibookclose`) presenting **both** the Book Close UI AND the TDS Calculator inline
- One backend repo (`aitdsrecon/backend`) running **one uvicorn process on port 8000** that serves:
  - TDS Calculator endpoints (auth-gated, session-based)
  - TDS 26Q Recon endpoints (open, file-upload-driven)
  - GST recon endpoints

---

## 2. Repository layout after integration

### Frontend — `Scaleupcfoai/aibookclose`
```
src/
├── App.jsx                       # main shell with checklist
├── TdsRecon.jsx                  # TDS 26Q Recon view (existing)
├── GstRecon.jsx                  # GST tiles view (existing)
├── tds-calc/                     # NEW — TDS Calculator UI (was separate repo)
│   ├── TdsCalculator.jsx         # wrapper with auto dev-bypass auth
│   ├── components/Upload.jsx, AgentStream.jsx, FlagReview.jsx,
│   │   ProposalReview.jsx, TDSReport.jsx
│   └── lib/api.js, format.js
├── data/mockData.js              # added task t12a "Calculate TDS for Deduction"
└── ...
vite.config.js                    # added proxy: /api + /auth → 127.0.0.1:8000
```

### Backend — `Scaleupcfoai/aitdsrecon`
```
backend/
├── api_server.py                 # main FastAPI app — mounts BOTH routers
├── auth.py, session.py           # TDS Calc auth/session
├── agents/                       # TDS Calc agents (orchestrator, etc.)
├── shared_tools/, tds_knowledge/ # TDS Calc helpers
├── recon/                        # NEW SUBPACKAGE — was standalone tds-recon/
│   ├── router.py                 # APIRouter (was a FastAPI app)
│   ├── reconcile.py              # pipeline orchestrator
│   ├── agents/                   # Parser, Matcher, Checker, Reporter, Learning
│   └── data/parsed/, data/results/, data/rules/
└── requirements.txt
```

---

## 3. Functional features delivered

| # | Feature | Files touched |
|---|---|---|
| 1 | New checklist task "Calculate TDS for Deduction" in Sub-Ledger Close phase | `mockData.js`, `App.jsx` |
| 2 | Inline TDS Calculator in centre panel when task is clicked | `App.jsx:489-491` |
| 3 | Auto dev-bypass auth for TDS Calculator (skips Google login screen) | `tds-calc/TdsCalculator.jsx` |
| 4 | Single backend process for TDS Calc + Recon (was two separate uvicorns) | `backend/api_server.py:68-70` |
| 5 | Form 26Q + Tally upload endpoint added | `backend/recon/router.py:73-102` |
| 6 | SSE streaming endpoints for cached + uploaded runs | `backend/recon/router.py:189-205` |
| 7 | Download endpoint for result CSVs/JSONs | `backend/recon/router.py:256-271` |
| 8 | Frontend uses Vite proxy (relative URLs) instead of cross-origin localhost | `aibookclose/src/{TdsRecon,GstRecon}.jsx`, `vite.config.js` |

---

## 4. Complete change-log (commits) on the integration branch

### Backend — `aitdsrecon` branch `claude/integrate-tds-calculator-YruaY`
```
033082f Add Lekha TDS Calculator backend (FastAPI + agentic runtime)
ed24c33 Merge tds-recon backend into main backend
0b64103 Add upload, SSE stream, and download endpoints to recon router
d01f746 Fix NameError in recon pipeline (orphan run_pipeline stub)
3fc7477 Force UTF-8 stdout to fix UnicodeEncodeError on Windows console
7910d55 Make event_logger.print() unicode-safe at the call site
11821ed Wrap sys.stdout buffer with UTF-8 TextIOWrapper for full coverage
25f10da Fix CSV writes failing on Windows: add encoding='utf-8'
```

### Frontend — `aibookclose` branch `claude/integrate-tds-calculator-YruaY`
```
8faca79 Integrate Lekha TDS Calculator into Sub-Ledger Close checklist
80d803a Fix not_authenticated: auto dev-bypass login in TdsCalculator
2daebb5 Move TdsRecon and GstRecon backend to port 8001  (then reverted)
3c4c497 Revert TdsRecon and GstRecon back to localhost:8000
74ac6d4 Route TdsRecon and GstRecon through Vite proxy (relative URLs)
```

---

## 5. What's working today

Verified in browser + uvicorn logs (May 3, 2026):

- ✅ Backend starts cleanly with all agents reachable via `/docs`
- ✅ TDS Calculator inline (`Calculate TDS for Deduction` checklist task) — full upload + agent run + report flow works
- ✅ Form 26Q upload reaches backend (`POST /api/upload` returns 200)
- ✅ Pipeline executes end-to-end on backend in ~3s: Parser → Matcher → TDS Checker → Reporter
- ✅ Result files written to `backend/recon/data/results/`:
  - `reconciliation_summary.json`
  - `reconciliation_report.csv` (56 rows)
  - `findings_report.csv` (8 rows)
- ✅ All Windows-console encoding crashes fixed (`₹`, `─`, `—`, etc.)

---

## 6. The two remaining symptoms (what the reviewer should focus on)

### Symptom A — Drip-feed agent narration not appearing in chat panel
The TDS 26Q Recon view chat panel **skips straight to the final summary** instead of showing the progressive agent events ("Parser starting", "Pass 1: 28 exact matches", etc.) as they happen.

### Symptom B — KPI cards show 0 in the count line, but real values in the amount line
Top of card is the count (matched/reconciled count); bottom of card is the rupee amount. **Counts come from a different field than amounts** — when SSE fails, the frontend falls back to `/api/results` which reads stale JSON from a previous run that may have a different schema → counts read 0 while amounts show the cached previous-run totals.

Screenshot of the broken state:
```
0                 0                 0                  0                 0
GE Analysed       Reconciled        TDS Reconciled     Expense Exempted  Flagged for Review
₹6,85,92,520      ₹85,37,164        ₹7,77,402          ₹6,00,55,356      ₹1,21,397
Total expenses    Expenses          TDS amount         Exempted          Amount flagged
in books          reconciled        reconciled         expense amount    for review
```

---

## 7. Root cause — `evtSource.onerror` race in TdsRecon.jsx (REVISED — original Vite-proxy hypothesis was wrong)

### Initial hypothesis that turned out to be wrong

Earlier draft of this note suspected Vite's dev proxy was buffering SSE responses. **That was incorrect.** Three independent code-trace passes confirmed:

- Vite proxy uses `http-proxy` which streams transparently with no buffering settings.
- The original `lekha-tds-calculator` repo uses an identical proxy config and works fine.
- The TDS Calculator inline view in this same app (`AgentStream.jsx`) consumes its own SSE stream through this same proxy without any issue.
- Backend `StreamingResponse` yields events progressively in real-time (verifiable with `curl -N`).

### Actual root cause — frontend race condition

The bug is in `src/TdsRecon.jsx:291-299` — the original `evtSource.onerror` handler:

```js
evtSource.onerror = () => {
  evtSource.close();
  fetch(`${API}/api/results`).then(r => r.json()).then(data => {
    setResults(data);          // ← stale JSON from disk
    setStatus('done');
  });
};
```

`EventSource.onerror` fires every time the SSE connection closes — including the **normal close** right after the backend's generator returns following its final `pipeline_complete` event. So this handler runs on EVERY successful run, not just on real failures.

### The chain that produces both symptoms

1. Browser opens `EventSource('/api/run/stream/upload')` → SSE connects.
2. Backend yields ~15 events progressively. Frontend's `onmessage` enqueues them via `enqueueEvent()` for drip-fed reveal.
3. Backend yields `pipeline_complete` (with fresh `results` payload embedded — see `router.py:159-181`). Frontend's `onmessage` sees it, calls `evtSource.close()`, enqueues it as the final drain item.
4. Connection closes. **Browser fires `onerror` because the stream ended.**
5. The (broken) `onerror` handler immediately runs `fetch('/api/results')`, which returns the JSON files on disk — possibly fresh, possibly partially-written, possibly stale from a prior run.
6. `setResults(stale_data)` overwrites whatever the SSE was building up.
7. `setStatus('done')` flips the UI to its summary view immediately.
8. Meanwhile the drip-feed drain loop is still running with `setTimeout(next, 400-1200ms)` — the user's chat panel has already been replaced with the summary, so the drip-feed effectively never plays even though the events are technically being emitted.

Both Symptom A (no drip-feed) and Symptom B (0 counts + real ₹ amounts) reduce to the same root cause: the `onerror` fallback hijacks the happy path.

The working `AgentStream.jsx:53` in the TDS Calculator side uses `es.onerror = () => {};` (no-op) — that's why it never has this bug.

### Why "0 counts but real ₹ amounts" specifically

When `/api/results` returns stale JSON, its top-level `summary.matching.matched` (count fields) may be 0 or missing because the schema doesn't have them populated, while `summary.amounts.total_form26_payments` etc. retain values from a prior successful run. The KPI rendering reads counts from one part of the object and amounts from another — explaining the asymmetry.

---

## 8. Fix applied

Three surgical changes, all in the frontend:

### Change 1 — Add `pipelineCompleteRef`

```js
const pipelineCompleteRef = useRef(false);
```

Reset to `false` at the start of each `runPipeline()` call (alongside the existing `eventQueueRef` reset).

### Change 2 — Set the flag when `pipeline_complete` arrives

In `evtSource.onmessage`:

```js
if (event.type === 'pipeline_complete') {
  pipelineCompleteRef.current = true;
  evtSource.close();
  enqueueEvent({ ...event, _pipelineComplete: true });
  return;
}
```

### Change 3 — Make `onerror` smart about normal vs failure close

```js
evtSource.onerror = () => {
  evtSource.close();
  // Normal close after pipeline_complete — let the drip-feed drain. The
  // drain handler already calls setResults() + setStatus('done') on the
  // _pipelineComplete marker (TdsRecon.jsx:105-121).
  if (pipelineCompleteRef.current) return;

  // Real failure: backend died or stream dropped mid-run. Recover with
  // cached results but flag as 'error' so users can distinguish.
  fetch(`${API}/api/results`).then(r => r.json()).then(data => {
    setResults(data);
    setRunCount(prev => prev + 1);
    setStatus('error');
  }).catch(() => setStatus('error'));
};
```

The drain loop already handles `_pipelineComplete: true` items correctly (`TdsRecon.jsx:105-121`) — it calls `setResults(item.results)` from the live SSE payload, then `setStatus('done')`. No backend or drain-loop changes needed.

### Optional defensive backend change

Added explicit anti-buffering headers to `backend/recon/router.py:186` to protect against future reverse-proxy deployments (nginx, Cloudflare, corporate gateways):

```python
return StreamingResponse(
    gen(),
    media_type="text/event-stream",
    headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
    },
)
```

Vite's dev proxy doesn't need these but they're standard SSE-server etiquette.

---

## 9. How to reproduce

### Backend (terminal 1)
```cmd
cd C:\Users\Ashish\recon-demo\backend
git checkout claude/integrate-tds-calculator-YruaY
git pull
set PYTHONIOENCODING=utf-8
uvicorn api_server:app --reload --port 8000
```

### Frontend (terminal 2)
```cmd
cd C:\Users\Ashish\aibookclose
git checkout claude/integrate-tds-calculator-YruaY
git pull
npm run dev
```

### Browser
1. Open `http://localhost:5175/`
2. Click **Reconciliations** in left nav
3. Click **TDS 26Q Recon** tile
4. Click **Upload & Run**
5. Pick `Form 26Q.xlsx` and `Tally.xlsx` (sample files in `recon-demo/backend/recon/data/uploads/`)
6. Observe: pipeline runs in backend (visible in uvicorn terminal) but UI skips to summary without drip-feed

### Expected behaviour
Chat panel should show ~15 events drip-feeding in over ~3s:
```
* [Parser Agent] Starting Parser Agent...
OK [Parser Agent] Parsed input files
* [Matcher Agent] Starting Matcher Agent...
- [Matcher Agent] Pass 1: 28 exact matches
... etc ...
OK [Pipeline] Complete in 3.1s
```

KPI counts should populate to:
- GE Analysed: **85**
- Reconciled: **56**
- TDS Reconciled: **56**
- Flagged for Review: **3**

---

## 10. Pointers for the reviewer

- Open Chrome DevTools → Network tab → click `stream/upload` row → Response tab. If you see the SSE chunks arriving line-by-line, browser is fine and the issue is purely in how the frontend handles them. If chunks only appear at the end, the proxy is buffering.
- Run the SSE endpoint directly with curl to confirm the backend streams in real-time (bypassing Vite):
  ```cmd
  curl -N http://127.0.0.1:8000/api/run/stream
  ```
  Expected: events drip out one by one over ~3s. If they all arrive in one burst at the end, the backend itself is the problem (less likely given uvicorn logs).
- The fact that uvicorn logs show events being printed in real-time strongly suggests the backend IS streaming correctly and the proxy/frontend pair is the broken link.

---

## 11. Files actually changed by the fix

| Repo | File | Change |
|---|---|---|
| aibookclose | `src/TdsRecon.jsx` | Added `pipelineCompleteRef`, gated `onerror` so it only triggers fallback on real failures, drives status/results from the drip-feed drain instead of the post-stream fallback |
| aitdsrecon | `backend/recon/router.py:186` | Added `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` headers (defensive, not required for Vite dev) |
| aibookclose | `vite.config.js` | **No change needed.** Original Vite-proxy hypothesis was wrong. |

No agent, pipeline, EventLogger, or backend SSE-generator changes — those were always healthy.
