import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { problems, polygon, ProblemSummary } from '../api/client';

export default function ProblemsPage() {
  const navigate = useNavigate();
  const [list, setList] = useState<ProblemSummary[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [cloningId, setCloningId] = useState<number | null>(null);
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Polygon import state
  const [showPolygon, setShowPolygon] = useState(false);
  const [pgId, setPgId] = useState('');
  const [pgKey, setPgKey] = useState('');
  const [pgSecret, setPgSecret] = useState('');
  const [pgRemember, setPgRemember] = useState(false);
  const [pgImporting, setPgImporting] = useState(false);
  const [pgMsg, setPgMsg] = useState('');
  const [pgError, setPgError] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [hasSavedKey, setHasSavedKey] = useState(false);

  useEffect(() => {
    reload();
    polygon.savedKey().then(r => {
      setHasSavedKey(r.hasKey);
      setSavedKey(r.apiKey);
      if (r.apiKey) setPgKey(r.apiKey);
      if (r.apiSecret) setPgSecret(r.apiSecret);
    }).catch(() => {});
  }, []);

  function reload() {
    setLoading(true);
    problems.list().then(setList).catch(e => setError(e.message)).finally(() => setLoading(false));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await problems.create(newName.trim());
      setNewName('');
      reload();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(p: ProblemSummary) {
    if (!window.confirm(`Delete problem "${p.shortName}"? This cannot be undone.`)) return;
    try {
      await problems.delete(p.id);
      reload();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function handleClone(p: ProblemSummary) {
    setCloningId(p.id);
    setError('');
    try {
      const res = await problems.clone(p.id);
      reload();
      navigate(`/problem/${res.id}/general`);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setCloningId(null);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportMsg(`Uploading ${file.name}...`);
    try {
      const result = await problems.importPackage(file, false);
      setImportMsg(`Imported "${result.shortName}": ${result.filesImported} files, ${result.testsImported} tests${result.warnings.length ? '\nWarnings: ' + result.warnings.join('; ') : ''}`);
      reload();
    } catch (err: unknown) {
      setImportMsg('Import failed: ' + (err as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handlePolygonImport(e: React.FormEvent) {
    e.preventDefault();
    setPgMsg(''); setPgError('');
    const id = parseInt(pgId);
    if (!id) { setPgError('Enter a numeric Polygon problem ID'); return; }
    const key = pgKey.trim() || savedKey || '';
    const secret = pgSecret.trim();
    if (!key || !secret) { setPgError('API key and secret are required'); return; }
    setPgImporting(true);
    try {
      const result = await polygon.importProblem(id, key, secret, pgRemember);
      if (pgRemember) { setHasSavedKey(true); setSavedKey(key); }
      setPgMsg(`Imported "${result.shortName}" (Polygon rev ${result.packageRevision}): ${result.filesImported} files, ${result.testsImported} tests${result.warnings.length ? '\nWarnings: ' + result.warnings.join('; ') : ''}`);
      reload();
    } catch (err: unknown) {
      setPgError('Import failed: ' + (err as Error).message);
    } finally {
      setPgImporting(false);
    }
  }

  async function handleClearKey() {
    try {
      await polygon.clearKey();
      setHasSavedKey(false); setSavedKey(null); setPgKey(''); setPgSecret('');
    } catch { /* ignore */ }
  }

  function formatMemory(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(0)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
    return `${bytes} B`;
  }

  return (
    <div className="content">
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <h2>My Problems</h2>
        <div className="flex">
          <form onSubmit={handleCreate} className="flex">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="short-name"
              style={{ width: 160 }}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={creating}>
              + New Problem
            </button>
          </form>
          <label className="btn btn-sm" style={{ cursor: importing ? 'not-allowed' : 'pointer', opacity: importing ? 0.6 : 1 }}>
            {importing ? <><span className="spinner" style={{ marginRight: 4 }} />Uploading...</> : 'Upload Package'}
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              onChange={handleImport}
              style={{ display: 'none' }}
              disabled={importing}
            />
          </label>
          <button
            className="btn btn-sm"
            onClick={() => { setShowPolygon(!showPolygon); setPgMsg(''); setPgError(''); }}
            style={{ background: showPolygon ? '#2264b0' : undefined, color: showPolygon ? 'white' : undefined }}
          >
            Polygon API
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {importMsg && (
        <div className={`alert ${importMsg.startsWith('Import failed') ? 'alert-error' : 'alert-success'}`}
          style={{ whiteSpace: 'pre-line' }}>
          <div className="flex" style={{ alignItems: 'flex-start', gap: 8 }}>
            {importing && <span className="spinner" style={{ marginTop: 1 }} />}
            <span style={{ flex: 1 }}>{importMsg}</span>
            {!importing && <button className="btn btn-sm" onClick={() => setImportMsg('')}>×</button>}
          </div>
          {importing && <div className="progress-bar" style={{ marginTop: 6 }}><div className="progress-bar-fill-indeterminate" /></div>}
        </div>
      )}

      {/* Polygon API Import Panel */}
      {showPolygon && (
        <div style={{ marginBottom: 16, padding: '12px 16px', border: '1px solid #c0d0f0', background: '#f8faff', borderRadius: 4 }}>
          <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 8, color: '#2264b0' }}>
            Import from Codeforces Polygon API
          </div>
          <p style={{ fontSize: 12, color: '#666', margin: '0 0 8px' }}>
            Get your API key at{' '}
            <a href="https://polygon.codeforces.com/settings" target="_blank" rel="noreferrer">polygon.codeforces.com/settings</a>.
            The problem must have a built "Full package (Linux)" on Polygon.
          </p>

          {hasSavedKey && (
            <div style={{ fontSize: 12, marginBottom: 8, padding: '4px 8px', background: '#f0f8f0', border: '1px solid #c0d8c0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Saved key: <code>{savedKey}</code></span>
              <button className="btn btn-sm btn-danger" onClick={handleClearKey} style={{ fontSize: 11 }}>Clear</button>
            </div>
          )}

          {pgMsg && <div className="alert alert-success" style={{ whiteSpace: 'pre-line', marginBottom: 8 }}>{pgMsg}</div>}
          {pgError && <div className="alert alert-error" style={{ marginBottom: 8 }}>{pgError}</div>}

          <form onSubmit={handlePolygonImport}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <label style={{ fontSize: 12 }}>
                Polygon Problem ID:&nbsp;
                <input
                  type="number"
                  value={pgId}
                  onChange={e => setPgId(e.target.value)}
                  placeholder="123456"
                  style={{ width: 100, fontSize: 12, padding: '2px 6px', border: '1px solid #aaa' }}
                  required
                />
              </label>
              <label style={{ fontSize: 12 }}>
                API Key:&nbsp;
                <input
                  type="text"
                  value={pgKey}
                  onChange={e => setPgKey(e.target.value)}
                  placeholder="API key"
                  style={{ width: 200, fontSize: 12, padding: '2px 6px', border: '1px solid #aaa' }}
                />
              </label>
              <label style={{ fontSize: 12 }}>
                API Secret:&nbsp;
                <input
                  type="password"
                  value={pgSecret}
                  onChange={e => setPgSecret(e.target.value)}
                  placeholder="API secret"
                  style={{ width: 200, fontSize: 12, padding: '2px 6px', border: '1px solid #aaa' }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={pgRemember} onChange={e => setPgRemember(e.target.checked)} />
                Remember API key
              </label>
              <button type="submit" className="btn btn-primary btn-sm" disabled={pgImporting}>
                {pgImporting ? <><span className="spinner" style={{ marginRight: 4 }} />Importing…</> : 'Import from Polygon'}
              </button>
            </div>
            {pgImporting && <div className="progress-bar" style={{ marginTop: 6 }}><div className="progress-bar-fill-indeterminate" /></div>}
          </form>
        </div>
      )}

      {loading ? (
        <div>Loading...</div>
      ) : list.length === 0 ? (
        <div style={{ color: '#888', padding: 20 }}>No problems yet. Create one or upload a Polygon package.</div>
      ) : (
        <table className="poly-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Short Name</th>
              {list[0]?.ownerUsername !== undefined && <th>Owner</th>}
              <th>Rev</th>
              <th>TL (ms)</th>
              <th>ML</th>
              <th>I/O</th>
              <th>Modified</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.map(p => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td><Link to={`/problem/${p.id}`}>{p.shortName}</Link></td>
                {p.ownerUsername !== undefined && <td style={{ color: '#555', fontSize: 12 }}>{p.ownerUsername}</td>}
                <td>{p.revision}</td>
                <td>{p.timeLimit}</td>
                <td>{formatMemory(p.memoryLimit)}</td>
                <td>
                  {p.inputFile || 'stdin'} / {p.outputFile || 'stdout'}
                  {p.interactive ? ' (interactive)' : ''}
                </td>
                <td style={{ color: p.modified ? '#c60' : 'green' }}>
                  {p.modified ? 'Modified' : 'Clean'}
                </td>
                <td style={{ color: '#888', fontSize: 11 }}>{p.updatedAt.slice(0, 16)}</td>
                <td style={{ display: 'flex', gap: 4 }}>
                  <Link to={`/problem/${p.id}`} className="btn btn-sm">Open</Link>
                  <button className="btn btn-sm" onClick={() => handleClone(p)} disabled={cloningId === p.id}
                    title="Duplicate this problem">
                    {cloningId === p.id ? 'Cloning…' : 'Clone'}
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(p)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
