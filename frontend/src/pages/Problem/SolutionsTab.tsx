import React, { useState, useEffect, useRef } from 'react';
import { problems, Solution } from '../../api/client';

interface Props { problemId: number; }

const TAGS = ['main', 'accepted', 'wrong-answer', 'time-limit-exceeded', 'time-limit-exceeded-or-accepted',
  'time-limit-exceeded-or-memory-limit-exceeded', 'memory-limit-exceeded', 'presentation-error',
  'runtime-error', 'do-not-run', 'rejected'];

export default function SolutionsTab({ problemId }: Props) {
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [content, setContent] = useState('');
  const [newSol, setNewSol] = useState({ sourcePath: '', sourceType: 'cpp.g++17', tag: 'accepted' });
  const [viewSrc, setViewSrc] = useState<{ path: string; content: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { reload(); }, [problemId]);

  function reload() {
    problems.solutions(problemId).then(setSolutions).catch(e => setError(e.message));
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(reader.result as string);
      if (!newSol.sourcePath) setNewSol(s => ({ ...s, sourcePath: 'solutions/' + file.name }));
    };
    reader.readAsText(file);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      await problems.saveSolution({ problemId, ...newSol, content: content || undefined });
      setMsg('Solution saved');
      setNewSol({ sourcePath: '', sourceType: 'cpp.g++17', tag: 'accepted' });
      setContent('');
      if (fileRef.current) fileRef.current.value = '';
      reload();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function handleView(sol: Solution) {
    try {
      const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/problem.viewSolution?problemId=${problemId}&solutionId=${sol.id}`, { credentials: 'include' });
      const text = await res.text();
      setViewSrc({ path: sol.source_path, content: text });
    } catch {
      setError('Failed to load');
    }
  }

  function tagColor(tag: string): string {
    if (tag === 'main') return '#00a';
    if (tag.includes('wrong-answer')) return 'red';
    if (tag.includes('accepted')) return 'green';
    if (tag.includes('time-limit')) return '#c60';
    if (tag.includes('memory')) return 'purple';
    if (tag === 'rejected') return '#888';
    return '#333';
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <h2>Solutions</h2>
        <span style={{ color: '#666', fontSize: 12 }}>{solutions.length} solution(s)</span>
      </div>

      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <table className="poly-table" style={{ marginBottom: 12 }}>
        <thead>
          <tr><th>#</th><th>Source Path</th><th>Type</th><th>Tag</th><th>Compiled</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {solutions.map(s => (
            <tr key={s.id}>
              <td>{s.id}</td>
              <td><span className="source-type">{s.source_path}</span></td>
              <td><span className="source-type">{s.source_type}</span></td>
              <td style={{ color: tagColor(s.tag), fontWeight: s.tag === 'main' ? 'bold' : 'normal' }}>
                {s.tag}
              </td>
              <td>{s.compiled_binary ? '✓' : '—'}</td>
              <td>
                <button className="btn btn-sm" onClick={() => handleView(s)}>View</button>
              </td>
            </tr>
          ))}
          {solutions.length === 0 && <tr><td colSpan={6} style={{ color: '#888' }}>No solutions</td></tr>}
        </tbody>
      </table>

      {viewSrc && (
        <div style={{ marginBottom: 12 }}>
          <div className="flex-between" style={{ marginBottom: 4 }}>
            <strong>{viewSrc.path}</strong>
            <button className="btn btn-sm" onClick={() => setViewSrc(null)}>Close</button>
          </div>
          <div className="code-view">{viewSrc.content}</div>
        </div>
      )}

      <div className="section-header">Add Solution</div>
      <form onSubmit={handleSave}>
        <div className="form-row">
          <label>Upload file:</label>
          <input ref={fileRef} type="file" accept=".cpp,.py,.java,.pas,.c,.go" onChange={handleFile}
            style={{ fontSize: 12 }} />
        </div>
        <div className="form-row">
          <label>Source path:</label>
          <input type="text" value={newSol.sourcePath} onChange={e => setNewSol({ ...newSol, sourcePath: e.target.value })}
            placeholder="solutions/main.cpp" style={{ width: 260 }} required />
        </div>
        <div className="form-row">
          <label>Source type:</label>
          <select value={newSol.sourceType} onChange={e => setNewSol({ ...newSol, sourceType: e.target.value })}>
            <option value="cpp.g++17">cpp.g++17</option>
            <option value="cpp.g++20">cpp.g++20</option>
            <option value="cpp.gcc14-64-msys2-g++23">cpp.gcc14-64-msys2-g++23</option>
          </select>
        </div>
        <div className="form-row">
          <label>Tag:</label>
          <select value={newSol.tag} onChange={e => setNewSol({ ...newSol, tag: e.target.value })}>
            {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <label style={{ marginBottom: 4 }}>Content (paste or upload above):</label>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            style={{ width: '100%', minHeight: 120, fontFamily: 'monospace', fontSize: 11 }}
            placeholder="Paste source code here, or upload a file above"
          />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">Save Solution</button>
        </div>
      </form>
    </div>
  );
}
