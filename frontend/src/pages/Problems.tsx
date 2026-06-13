import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { problems, ProblemSummary } from '../api/client';

export default function ProblemsPage() {
  const [list, setList] = useState<ProblemSummary[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    reload();
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

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportMsg('Importing...');
    try {
      const result = await problems.importPackage(file, false);
      setImportMsg(`Imported: ${result.shortName} (${result.filesImported} files, ${result.testsImported} tests)${result.warnings.length ? '\nWarnings: ' + result.warnings.join('; ') : ''}`);
      reload();
    } catch (err: unknown) {
      setImportMsg('Import failed: ' + (err as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
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
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            Upload Package
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              onChange={handleImport}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {importMsg && (
        <div className={`alert ${importMsg.startsWith('Import failed') ? 'alert-error' : 'alert-success'}`}
          style={{ whiteSpace: 'pre-line' }}>
          {importMsg}
          <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setImportMsg('')}>×</button>
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
