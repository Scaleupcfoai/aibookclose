// Frontend configuration — reads from Vite environment variables
// Usage: import { API_URL, ENDPOINTS } from './config';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Production backend endpoints (app/main.py structure)
export const ENDPOINTS = {
  // Auth
  health: '/api/health',
  authMe: '/api/auth/me',
  registerFirm: '/api/auth/register-firm',

  // Companies
  companies: '/api/companies',
  company: (id) => `/api/companies/${id}`,

  // Upload & Column Mapping
  upload: '/api/upload',
  mapColumns: '/api/upload/map-columns',

  // Reconciliation (SSE streaming)
  reconStream: '/api/reconciliation/stream',
  reconRun: '/api/reconciliation/run',
  reconStatus: (runId) => `/api/reconciliation/status/${runId}`,
  reconRuns: '/api/reconciliation/runs',

  // Reports
  reportSummary: (runId) => `/api/reports/${runId}/summary`,
  reportFindings: (runId) => `/api/reports/${runId}/findings`,
  reportDownload: (runId, filename) => `/api/reports/${runId}/download/${filename}`,

  // Chat
  chat: '/api/chat',
  chatStream: '/api/chat/stream',
  chatReset: '/api/chat/reset',

  // Pipeline interaction
  answer: '/api/answer',
};
