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

## 7. Suspected root cause — Vite dev proxy not compatible with SSE out of the box

### The relevant code paths

**Frontend SSE consumer** — `src/TdsRecon.jsx:269-303`:
```js
const evtSource = new EventSource(streamUrl);   // streamUrl = '/api/run/stream/upload'

evtSource.onmessage = (msg) => {
  // … queue event for drip-feed reveal …
};

evtSource.onerror = () => {
  evtSource.close();
  // ↓ THIS IS THE FALLBACK THAT MASKS THE PROBLEM ↓
  fetch(`${API}/api/results`).then(r => r.json()).then(data => {
    setResults(data);          // ← stale JSON from disk, written by previous run
    setStatus('done');
  });
};
```

**Backend SSE producer** — `backend/recon/router.py:127-186`:
- Runs pipeline in a worker thread
- `async def gen()` polls `EventLogger.events`, yields each new event as `data: {...json...}\n\n`
- Returns `StreamingResponse(gen(), media_type="text/event-stream")`
- Backend logs prove this generator runs and produces ~15 events per run.

**Vite proxy config** — `vite.config.js`:
```js
server: {
  port: 5175,
  proxy: {
    '/api':  { target: 'http://127.0.0.1:8000', changeOrigin: true },
    '/auth': { target: 'http://127.0.0.1:8000', changeOrigin: true },
  },
}
```

### Why this is suspicious

Vite's dev proxy is built on `http-proxy`. By default:
- **It does not flush the response body until the upstream connection closes**, which kills SSE — events accumulate buffered until the pipeline finishes, then arrive in one burst (or get dropped if the EventSource times out first).
- It does not preserve `Content-Type: text/event-stream` reliably under all configurations.
- `changeOrigin: true` rewrites the `Host` header but doesn't address streaming.

### The chain of failure that produces both symptoms

1. Browser opens `EventSource('/api/run/stream/upload')` → hits Vite (5175)
2. Vite proxies to FastAPI (8000) — backend starts streaming events
3. Vite buffers the response → browser sees nothing for several seconds
4. EventSource times out OR the proxy connection breaks → `evtSource.onerror` fires
5. Fallback path runs: `fetch('/api/results')` → returns whatever JSON is on disk from the **previous** run
6. UI renders that stale JSON
7. Drip-feed never plays because no `evtSource.onmessage` events ever fired

This explains **both** Symptom A (no drip-feed) and Symptom B (stale data): a single underlying cause.

---

## 8. Proposed fixes the reviewer should evaluate

### Fix 1 (preferred) — Disable buffering for SSE routes in Vite proxy

```js
// vite.config.js
proxy: {
  '/api/run/stream': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
    // Critical: don't buffer / compress streaming responses
    configure: (proxy) => {
      proxy.on('proxyRes', (proxyRes) => {
        proxyRes.headers['cache-control'] = 'no-cache, no-transform';
      });
    },
  },
  '/api':  { target: 'http://127.0.0.1:8000', changeOrigin: true },
  '/auth': { target: 'http://127.0.0.1:8000', changeOrigin: true },
}
```

Note that the more specific `/api/run/stream` entry must come BEFORE the catch-all `/api`.

### Fix 2 — Bypass proxy for SSE only

Have the frontend connect directly to `http://127.0.0.1:8000/api/run/stream/upload` (full URL) only for the EventSource, and keep relative URLs for everything else. Trade-off: re-introduces CORS for that one endpoint; backend already allows `localhost:5175` so should be fine.

### Fix 3 — Drop SSE entirely, use polling

Frontend POSTs `/api/upload`, then polls `/api/run/status?job_id=X` every 250 ms. Backend stores events under a job ID. Trade-off: less elegant, more requests, but completely sidesteps the proxy issue.

### Other things worth a sanity check

- **Cached JSON pollution:** any leftover `reconciliation_summary.json` from previous runs is loaded by `/api/results` (`router.py:208-217`) and `_stream_pipeline` (`router.py:167-181`). Even when the live SSE works correctly, if the new run produces partial output, the response is mixed with stale fields.
- **Shared global `EventLogger`** (`backend/recon/agents/event_logger.py:62-73`): the module-level `_logger` object is reset per pipeline run via `reset_logger()`, but if two concurrent pipeline runs ever happened in the same process, they'd race. Probably out of scope right now but flagging for completeness.
- **Frontend `evtSource.onerror` is too aggressive:** it currently closes the stream and switches to the fallback fetch on the very first error event. EventSource can fire `onerror` for transient hiccups even when the stream is healthy. Logic should distinguish "stream closed" from "transient error".

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

## 11. Files most likely to be touched by the fix

| Repo | File | Likely change |
|---|---|---|
| aibookclose | `vite.config.js` | Add SSE-friendly proxy config |
| aibookclose | `src/TdsRecon.jsx:291-299` | Make `onerror` handler less aggressive |
| aitdsrecon | `backend/recon/router.py:127-186` | Possibly add `X-Accel-Buffering: no` response header |

No agent or pipeline logic should need changes — those are confirmed working.
