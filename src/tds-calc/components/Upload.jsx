import { useRef, useState } from 'react';
import { apiFetch } from '../lib/api.js';

export default function Upload({ onSessionCreated }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFile(file) {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch('/api/session/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(body.detail || 'Upload failed');
      }
      const data = await res.json();
      onSessionCreated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className={`upload-card ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFile(e.dataTransfer.files?.[0]);
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="upload-icon">↑</div>
      <div className="upload-title">
        {uploading ? 'Uploading...' : 'Drop your expense file'}
      </div>
      <div className="upload-sub">
        {uploading ? 'Lekha is opening the file' : 'or click to browse — .xlsx, .xls, .csv up to 10MB'}
      </div>
      {error && <div className="upload-error">{error}</div>}
    </div>
  );
}
