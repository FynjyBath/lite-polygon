import React, { useState, useEffect, useRef } from 'react';
import { problems, Solution } from '../../api/client';
import CodeEditor from '../../components/CodeEditor';

interface Props { problemId: number; }

const LANGUAGE_OPTIONS = [
  { value: 'cpp.g++17',  label: 'GNU G++17 7.3.0' },
  { value: 'cpp.g++20',  label: 'GNU G++20 11.2.0' },
  { value: 'cpp.g++23',  label: 'GNU G++23 14.2.0' },
  { value: 'python.3',   label: 'Python 3.8.10' },
  { value: 'pypy.3',     label: 'PyPy 3.9.10' },
  { value: 'java8',      label: 'Java 8 (javac)' },
  { value: 'java11',     label: 'Java 11 (javac)' },
  { value: 'java17',     label: 'Java 17 (javac)' },
];

const TAG_OPTIONS = [
  { value: 'main',                                    label: 'Main correct solution',                    color: '#007700' },
  { value: 'accepted',                                label: 'Accepted',                                 color: '#007700' },
  { value: 'rejected',                                label: 'Rejected',                                 color: 'var(--muted)' },
  { value: 'wrong-answer',                            label: 'Wrong answer',                             color: '#cc0000' },
  { value: 'presentation-error',                      label: 'Presentation error',                       color: '#cc0000' },
  { value: 'time-limit-exceeded',                     label: 'Time limit exceeded',                      color: '#cc0000' },
  { value: 'memory-limit-exceeded',                   label: 'Memory limit exceeded',                    color: '#cc0000' },
  { value: 'time-limit-exceeded-or-accepted',         label: 'Time limit exceeded or accepted',          color: '#cc6600' },
  { value: 'time-limit-exceeded-or-memory-limit-exceeded', label: 'TLE or MLE',                         color: '#cc6600' },
  { value: 'runtime-error',                           label: 'Runtime error',                            color: '#cc0000' },
  { value: 'do-not-run',                              label: 'Do not run',                               color: 'var(--muted)' },
];

function tagInfo(tag: string) {
  return TAG_OPTIONS.find(t => t.value === tag) ?? { label: tag, color: 'var(--fg)' };
}

function langLabel(sourceType: string) {
  return LANGUAGE_OPTIONS.find(l => l.value === sourceType)?.label ?? sourceType;
}

function fmtSize(bytes: number) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(2)} kB`;
}

function fmtDate(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function SolutionsTab({ problemId }: Props) {
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [error, setError] = useState('');

  // Rename state: solutionId → pending name
  const [renaming, setRenaming] = useState<Record<number, string>>({});

  // Edit modal
  const [editSol, setEditSol] = useState<{ sol: Solution; content: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // New file dialog
  const [newDialog, setNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLang, setNewLang] = useState('cpp.g++17');
  const [newTag, setNewTag] = useState('accepted');
  const [newContent, setNewContent] = useState('');
  const [newSaving, setNewSaving] = useState(false);

  const addFilesRef = useRef<HTMLInputElement>(null);

  useEffect(() => { reload(); }, [problemId]);

  function reload() {
    problems.solutions(problemId).then(setSolutions).catch(e => setError(e.message));
  }

  async function handleDelete(sol: Solution) {
    if (!confirm(`Delete ${sol.source_path}?`)) return;
    try {
      await problems.deleteSolution({ problemId, solutionId: sol.id });
      reload();
    } catch (e: unknown) { setError((e as Error).message); }
  }

  function handleDownload(sol: Solution) {
    const url = problems.downloadSolutionUrl(problemId, sol.id);
    window.open(url, '_blank');
  }

  async function handleRename(sol: Solution) {
    const newName = renaming[sol.id]?.trim();
    if (!newName || newName === sol.source_path.split('/').pop()) {
      setRenaming(r => { const c = { ...r }; delete c[sol.id]; return c; });
      return;
    }
    try {
      await problems.renameSolution({ problemId, solutionId: sol.id, newName });
      setRenaming(r => { const c = { ...r }; delete c[sol.id]; return c; });
      reload();
    } catch (e: unknown) { setError((e as Error).message); }
  }

  async function handleLangChange(sol: Solution, sourceType: string) {
    try {
      await problems.updateSolutionLang({ problemId, solutionId: sol.id, sourceType });
      reload();
    } catch (e: unknown) { setError((e as Error).message); }
  }

  async function handleTagChange(sol: Solution, tag: string) {
    try {
      await problems.updateSolutionTag({ problemId, solutionId: sol.id, tag });
      reload();
    } catch (e: unknown) { setError((e as Error).message); }
  }

  async function handleOpenEdit(sol: Solution) {
    try {
      const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
      const res = await fetch(`${base}/api/problem.viewSolution?problemId=${problemId}&solutionId=${sol.id}`, { credentials: 'include' });
      const text = await res.text();
      setEditSol({ sol, content: text });
    } catch { setError('Failed to load solution'); }
  }

  async function handleSaveEdit() {
    if (!editSol) return;
    setEditSaving(true);
    try {
      await problems.editSolution({ problemId, solutionId: editSol.sol.id, content: editSol.content });
      setEditSol(null);
      reload();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setEditSaving(false); }
  }

  async function handleAddFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    for (const file of files) {
      const content = await file.text();
      const sourcePath = 'solutions/' + file.name;
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const sourceType = ext === 'py' ? 'python.3' : ext === 'java' ? 'java17' : 'cpp.g++17';
      try {
        await problems.saveSolution({ problemId, sourcePath, sourceType, tag: 'accepted', content });
      } catch (e: unknown) { setError((e as Error).message); }
    }
    if (addFilesRef.current) addFilesRef.current.value = '';
    reload();
  }

  async function handleNewFile(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setNewSaving(true);
    const sourcePath = 'solutions/' + newName.trim();
    try {
      await problems.saveSolution({ problemId, sourcePath, sourceType: newLang, tag: newTag, content: newContent });
      setNewDialog(false);
      setNewName(''); setNewContent(''); setNewLang('cpp.g++17'); setNewTag('accepted');
      reload();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setNewSaving(false); }
  }

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}<button onClick={() => setError('')} style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>×</button></div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>Solution files</strong>
        <span>
          <a className="poly-link" style={{ marginRight: 12, cursor: 'pointer' }} onClick={() => setNewDialog(true)}>New File</a>
          <label className="poly-link" style={{ cursor: 'pointer' }}>
            Add Files
            <input ref={addFilesRef} type="file" multiple accept=".cpp,.py,.java,.pas,.c,.go" style={{ display: 'none' }} onChange={handleAddFiles} />
          </label>
        </span>
      </div>

      <table className="poly-table" style={{ width: '100%', marginBottom: 8 }}>
        <thead>
          <tr>
            <th>Author</th>
            <th>Name</th>
            <th>Language</th>
            <th>Length</th>
            <th>Modified</th>
            <th>Type</th>
            <th style={{ textAlign: 'right' }}>
              <span style={{ color: 'var(--accent)' }}>Delete&nbsp;Download&nbsp;Edit&nbsp;View</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {solutions.map(sol => {
            const tag = tagInfo(sol.tag);
            const fileName = sol.source_path.split('/').pop() ?? sol.source_path;
            const isRenaming = sol.id in renaming;
            return (
              <tr key={sol.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{sol.author}</td>
                <td style={{ minWidth: 160 }}>
                  {isRenaming ? (
                    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        value={renaming[sol.id]}
                        onChange={e => setRenaming(r => ({ ...r, [sol.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(sol); if (e.key === 'Escape') setRenaming(r => { const c = { ...r }; delete c[sol.id]; return c; }); }}
                        autoFocus
                        style={{ fontSize: 12, padding: '1px 4px', width: 140 }}
                      />
                      <a className="poly-link" style={{ cursor: 'pointer', fontSize: 11 }} onClick={() => handleRename(sol)}>OK</a>
                    </span>
                  ) : (
                    <span>
                      <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{fileName}</span>
                      <br />
                      <a className="poly-link" style={{ fontSize: 11, cursor: 'pointer' }} onClick={() => { /* note: no-op */ }}>Note</a>
                      {' '}
                      <a className="poly-link" style={{ fontSize: 11, cursor: 'pointer' }}
                        onClick={() => setRenaming(r => ({ ...r, [sol.id]: fileName }))}>Rename</a>
                    </span>
                  )}
                </td>
                <td>
                  <select
                    value={sol.source_type}
                    onChange={e => handleLangChange(sol, e.target.value)}
                    style={{ fontSize: 12, padding: '2px 4px' }}
                  >
                    {LANGUAGE_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtSize(sol.size)}</td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(sol.modified)}</td>
                <td style={{ minWidth: 130 }}>
                  <span style={{ color: tag.color, fontWeight: sol.tag === 'main' ? 'bold' : 'normal', fontSize: 13 }}>
                    {tag.label}
                  </span>
                  <br />
                  <select
                    value={sol.tag}
                    onChange={e => handleTagChange(sol, e.target.value)}
                    style={{ fontSize: 11, padding: '1px 2px', marginTop: 2 }}
                  >
                    {TAG_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <a className="poly-link" style={{ cursor: 'pointer', marginRight: 6, fontSize: 12 }}
                    onClick={() => handleDelete(sol)}>Delete</a>
                  <a className="poly-link" style={{ cursor: 'pointer', marginRight: 6, fontSize: 12 }}
                    onClick={() => handleDownload(sol)}>Download</a>
                  <a className="poly-link" style={{ cursor: 'pointer', marginRight: 6, fontSize: 12 }}
                    onClick={() => handleOpenEdit(sol)}>Edit</a>
                  <a className="poly-link" style={{ cursor: 'pointer', fontSize: 12 }}
                    onClick={() => handleOpenEdit(sol)}>View</a>
                </td>
              </tr>
            );
          })}
          {solutions.length === 0 && (
            <tr><td colSpan={7} style={{ color: 'var(--muted)', textAlign: 'center', padding: 16 }}>No solution files</td></tr>
          )}
        </tbody>
      </table>

      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0' }}>Upload solution files here.</p>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0' }}>There should be exactly one "Main correct solution" (also known as "model solution"). It will be used to generate jury answers.</p>

      {/* Edit / View modal */}
      {editSol && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 4, width: '80vw', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>{editSol.sol.source_path}</strong>
              <button className="btn btn-sm" onClick={() => setEditSol(null)}>Close</button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <CodeEditor
                value={editSol.content}
                onChange={v => setEditSol(s => s ? { ...s, content: v } : s)}
                sourceType={editSol.sol.source_type}
                height="60vh"
                onSave={handleSaveEdit}
              />
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? 'Saving...' : 'Save'}
              </button>
              <button className="btn" onClick={() => setEditSol(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* New file dialog */}
      {newDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', borderRadius: 4, width: 500, padding: 20 }}>
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>New Solution File</h3>
            <form onSubmit={handleNewFile}>
              <div className="form-row">
                <label>File name:</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="solution.cpp" autoFocus style={{ flex: 1 }} />
              </div>
              <div className="form-row">
                <label>Language:</label>
                <select value={newLang} onChange={e => setNewLang(e.target.value)} style={{ flex: 1 }}>
                  {LANGUAGE_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
              <div className="form-row">
                <label>Type:</label>
                <select value={newTag} onChange={e => setNewTag(e.target.value)} style={{ flex: 1 }}>
                  {TAG_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <label style={{ marginBottom: 4 }}>Content:</label>
                <CodeEditor
                  value={newContent}
                  onChange={setNewContent}
                  sourceType={newLang}
                  height={260}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                <button type="submit" className="btn btn-primary" disabled={newSaving}>{newSaving ? 'Saving…' : 'Create'}</button>
                <button type="button" className="btn" onClick={() => setNewDialog(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
