/**
 * API Service Layer — auth-aware fetch wrapper for the production backend.
 *
 * Usage:
 *   import { api, createAuthSSE } from './services/api';
 *   const data = await api.get('/api/companies');
 *   const data = await api.post('/api/upload', formData);
 *   const cleanup = createAuthSSE('/api/reconciliation/stream?company_id=X', onEvent, onError);
 */

import { API_URL } from '../config';

// Token storage — set after login, read on every request
let _authToken = null;

export function setAuthToken(token) {
  _authToken = token;
}

export function getAuthToken() {
  return _authToken;
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (_authToken) {
    headers['Authorization'] = `Bearer ${_authToken}`;
  }
  return headers;
}

/**
 * Core fetch wrapper — adds auth headers, parses JSON, handles errors.
 */
async function request(method, path, { body, headers: extraHeaders, raw } = {}) {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;

  const opts = { method, headers: authHeaders(extraHeaders) };

  if (body instanceof FormData) {
    // Don't set Content-Type for FormData — browser sets multipart boundary
    opts.body = body;
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);

  if (res.status === 401) {
    // Token expired or invalid — could redirect to login here
    console.warn('[API] 401 Unauthorized — token may be expired');
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }

  if (raw) return res;
  return res.json();
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { body, ...opts }),
  put: (path, body, opts) => request('PUT', path, { body, ...opts }),
  delete: (path, opts) => request('DELETE', path, opts),
};

/**
 * Auth-aware Server-Sent Events using fetch + ReadableStream.
 *
 * Native EventSource doesn't support custom headers (no auth).
 * This uses fetch() with streaming to parse SSE manually.
 *
 * Returns a cleanup function to abort the connection.
 */
export function createAuthSSE(path, onEvent, onError, onOpen) {
  const url = path.startsWith('http') ? path : `${API_URL}${path}`;
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(url, {
        headers: authHeaders(),
        signal: controller.signal,
      });

      if (!res.ok) {
        onError?.(new Error(`SSE connection failed: ${res.status}`));
        return;
      }

      onOpen?.();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              onEvent(event);
            } catch {
              // Ignore malformed JSON
            }
          }
        }
      }

      // Stream ended naturally — fire onError so caller knows
      onError?.(new Error('SSE stream ended'));
    } catch (err) {
      if (err.name !== 'AbortError') {
        onError?.(err);
      }
    }
  })();

  // Return cleanup function
  return () => controller.abort();
}
