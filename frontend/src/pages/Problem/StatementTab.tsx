import React, { useState, useEffect, useRef } from 'react';
import { problems, Statement } from '../../api/client';

interface Props { problemId: number; }

const KNOWN_LANGS = ['russian', 'english', 'chinese'];

export default function StatementTab({ problemId }: Props) {
  const [stmts, setStmts] = useState<Statement[]>([]);
  const [lang, setLang] = useState('russian');
  const [form, setForm] = useState({ name: '', legend: '', input: '', output: '', scoring: '', interaction: '', notes: '', tutorial: '' });
  const [preview, setPreview] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [showScoring, setShowScoring] = useState(false);
  const [resources, setResources] = useState<string[]>([]);
  const [uploadingResource, setUploadingResource] = useState(false);
  const [showAddLang, setShowAddLang] = useState(false);
  const [newLangInput, setNewLangInput] = useState('');
  const resourceInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { reload(); }, [problemId]);

  useEffect(() => {
    if (lang) reloadResources();
  }, [lang, problemId]);

  function reload() {
    problems.statements(problemId).then(list => {
      setStmts(list);
      if (list.length > 0) selectStmt(list[0]);
    });
  }

  function reloadResources() {
    problems.statementResources(problemId, lang).then(setResources).catch(() => setResources([]));
  }

  function selectStmt(s: Statement) {
    setLang(s.language);
    setForm({
      name: s.name, legend: s.legend, input: s.input_section, output: s.output_section,
      scoring: s.scoring, interaction: s.interaction, notes: s.notes, tutorial: s.tutorial,
    });
    setPreview('');
  }

  function switchLang(newLang: string) {
    setLang(newLang);
    const found = stmts.find(s => s.language === newLang);
    if (found) {
      selectStmt(found);
    } else {
      setForm({ name: '', legend: '', input: '', output: '', scoring: '', interaction: '', notes: '', tutorial: '' });
      setPreview('');
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      await problems.saveStatement({
        problemId, lang, name: form.name, legend: form.legend, input: form.input,
        output: form.output, scoring: form.scoring, interaction: form.interaction,
        notes: form.notes, tutorial: form.tutorial,
      });
      setMsg('Saved');
      reload();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteCurrent() {
    if (!stmts.find(s => s.language === lang)) return;
    if (!confirm(`Delete statement for "${lang}"?`)) return;
    setMsg(''); setError('');
    try {
      await problems.deleteStatement(problemId, lang);
      setMsg(`Statement "${lang}" deleted`);
      const remaining = stmts.filter(s => s.language !== lang);
      setStmts(remaining);
      if (remaining.length > 0) selectStmt(remaining[0]);
      else {
        setLang('russian');
        setForm({ name: '', legend: '', input: '', output: '', scoring: '', interaction: '', notes: '', tutorial: '' });
      }
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function handleCreateLang() {
    const trimmed = newLangInput.trim().toLowerCase();
    if (!trimmed) return;
    if (stmts.find(s => s.language === trimmed)) {
      switchLang(trimmed);
    } else {
      setLang(trimmed);
      setForm({ name: '', legend: '', input: '', output: '', scoring: '', interaction: '', notes: '', tutorial: '' });
      setPreview('');
    }
    setNewLangInput('');
    setShowAddLang(false);
  }

  async function handlePreview() {
    try {
      const result = await problems.renderStatements(problemId, lang);
      setPreview(result.html);
    } catch (err: unknown) {
      setPreview('<em>' + (err as Error).message + '</em>');
    }
  }

  async function handleUploadResource(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingResource(true);
    try {
      await problems.saveStatementResource(problemId, lang, file);
      reloadResources();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setUploadingResource(false);
      if (resourceInputRef.current) resourceInputRef.current.value = '';
    }
  }

  function f(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, [field]: e.target.value });
  }

  const hasCurrentStatement = !!stmts.find(s => s.language === lang);

  return (
    <div>
      {/* Language tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Statement</h2>
        {stmts.map(s => (
          <button
            key={s.language}
            className={`btn btn-sm${s.language === lang ? ' btn-primary' : ''}`}
            onClick={() => switchLang(s.language)}
          >
            {s.language}
          </button>
        ))}
        {showAddLang ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <select
              value={newLangInput}
              onChange={e => setNewLangInput(e.target.value)}
              style={{ fontSize: 12, padding: '2px 4px' }}
            >
              <option value="">-- pick --</option>
              {KNOWN_LANGS.filter(l => !stmts.find(s => s.language === l)).map(l => (
                <option key={l} value={l}>{l}</option>
              ))}
              <option value="__custom__">other...</option>
            </select>
            {newLangInput === '__custom__' && (
              <input
                autoFocus
                placeholder="e.g. czech"
                style={{ width: 80, fontSize: 12, padding: '2px 4px', border: '1px solid #aaa' }}
                onChange={e => setNewLangInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateLang()}
              />
            )}
            <button className="btn btn-sm btn-primary" onClick={handleCreateLang} disabled={!newLangInput || newLangInput === '__custom__'}>
              Create
            </button>
            <button className="btn btn-sm" onClick={() => { setShowAddLang(false); setNewLangInput(''); }}>✕</button>
          </span>
        ) : (
          <button className="btn btn-sm" onClick={() => setShowAddLang(true)}>+ New Language</button>
        )}
        {hasCurrentStatement && (
          <button className="btn btn-sm btn-danger" onClick={handleDeleteCurrent} style={{ marginLeft: 4 }}>
            Delete Current
          </button>
        )}
      </div>

      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <form onSubmit={handleSave}>
            <div className="form-row">
              <label>Name:</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ width: 300 }} />
            </div>
            {(['legend', 'input', 'output', 'interaction', 'notes'] as const).map(field => (
              <div key={field} className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <label style={{ marginBottom: 4, textTransform: 'capitalize' }}>{field}:</label>
                <textarea
                  value={form[field]}
                  onChange={f(field)}
                  style={{ width: '100%', minHeight: field === 'legend' ? 120 : 60 }}
                />
              </div>
            ))}
            <div className="form-row" style={{ marginBottom: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showScoring}
                  onChange={e => setShowScoring(e.target.checked)}
                />
                Show section &ldquo;Scoring&rdquo;
              </label>
            </div>
            {showScoring && (
              <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <label style={{ marginBottom: 4 }}>Scoring:</label>
                <textarea value={form.scoring} onChange={f('scoring')} style={{ width: '100%', minHeight: 60 }} />
              </div>
            )}
            <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <label style={{ marginBottom: 4 }}>Tutorial:</label>
              <textarea value={form.tutorial} onChange={f('tutorial')} style={{ width: '100%', minHeight: 80 }} />
            </div>
            <div className="form-actions flex">
              <button type="submit" className="btn btn-primary">Save</button>
              <button type="button" className="btn" onClick={handlePreview}>Preview</button>
            </div>
          </form>

          {/* Resource Files */}
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: '#2264b0', marginBottom: 4 }}>
              Statement Resource Files ({resources.length})
            </summary>
            <div style={{ paddingTop: 6 }}>
              {resources.length > 0 ? (
                <table className="poly-table" style={{ marginBottom: 8 }}>
                  <thead><tr><th>File</th><th>Download</th></tr></thead>
                  <tbody>
                    {resources.map(name => (
                      <tr key={name}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{name}</td>
                        <td>
                          <a
                            href={`/api/problem.viewStatementResource?problemId=${problemId}&lang=${lang}&name=${encodeURIComponent(name)}`}
                            className="btn btn-sm"
                            target="_blank"
                            rel="noreferrer"
                          >
                            ↓
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ color: '#888', fontSize: 11, marginBottom: 8 }}>No resource files yet</div>
              )}
              <label className="btn btn-sm" style={{ cursor: 'pointer', marginBottom: 0 }}>
                {uploadingResource ? <><span className="spinner" style={{ marginRight: 4 }} />Uploading...</> : 'Upload File'}
                <input ref={resourceInputRef} type="file" style={{ display: 'none' }} onChange={handleUploadResource} disabled={uploadingResource} />
              </label>
            </div>
          </details>
        </div>

        {preview && (
          <div style={{ flex: 1, border: '1px solid #ccc', padding: 12, background: '#fafafa', maxHeight: 600, overflowY: 'auto' }}>
            <div style={{ marginBottom: 8 }}>
              <button className="btn btn-sm" onClick={() => setPreview('')}>Close Preview</button>
            </div>
            <div dangerouslySetInnerHTML={{ __html: preview }} />
          </div>
        )}
      </div>
    </div>
  );
}
