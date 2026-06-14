import React, { useState, useEffect, useRef, useCallback } from 'react';
import { problems, Statement } from '../../api/client';
import { latexToHtml } from '../../utils/latexToHtml';
import 'katex/dist/katex.min.css';

interface Props { problemId: number; }

type Form = { name: string; legend: string; input: string; output: string; scoring: string; interaction: string; notes: string; tutorial: string };
const EMPTY: Form = { name: '', legend: '', input: '', output: '', scoring: '', interaction: '', notes: '', tutorial: '' };
const KNOWN_LANGS = ['russian', 'english', 'chinese'];

const SECTIONS: { key: keyof Form; label: string; rows: number }[] = [
  { key: 'legend',      label: 'Условие / Legend',           rows: 8 },
  { key: 'input',       label: 'Входные данные / Input',     rows: 4 },
  { key: 'output',      label: 'Выходные данные / Output',   rows: 4 },
  { key: 'interaction', label: 'Interaction',                 rows: 3 },
  { key: 'notes',       label: 'Примечания / Notes',         rows: 3 },
  { key: 'scoring',     label: 'Scoring',                     rows: 3 },
  { key: 'tutorial',    label: 'Tutorial / Разбор',          rows: 5 },
];

function useDebounce<T>(value: T, ms: number): T {
  const [dv, setDv] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDv(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return dv;
}

function LaTeXEditor({ value, onChange, rows, placeholder }: {
  value: string; onChange: (v: string) => void; rows: number; placeholder?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = el;
      const next = el.value.slice(0, s) + '  ' + el.value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = s + 2;
      });
    }
  }
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      rows={rows}
      placeholder={placeholder}
      style={{
        width: '100%', fontFamily: '"Fira Code", "Courier New", monospace',
        fontSize: 12, lineHeight: 1.5, resize: 'vertical',
        border: '1px solid #ccc', borderRadius: 3, padding: '6px 8px',
        background: '#1e1e2e', color: '#cdd6f4', outline: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
}

function StatementPreview({ form, examples }: { form: Form; examples: string[][] }) {
  const html = useCallback((text: string) => latexToHtml(text), []);
  return (
    <div className="stmt-preview">
      {form.name && <h1 className="stmt-title">{form.name}</h1>}
      {form.legend && (
        <section>
          <div dangerouslySetInnerHTML={{ __html: html(form.legend) }} />
        </section>
      )}
      {form.input && (
        <section>
          <h3 className="stmt-h3">Входные данные</h3>
          <div dangerouslySetInnerHTML={{ __html: html(form.input) }} />
        </section>
      )}
      {form.output && (
        <section>
          <h3 className="stmt-h3">Выходные данные</h3>
          <div dangerouslySetInnerHTML={{ __html: html(form.output) }} />
        </section>
      )}
      {examples.length > 0 && (
        <section>
          <h3 className="stmt-h3">Примеры</h3>
          {examples.map(([inp, out], i) => (
            <div key={i} className="stmt-example">
              <div className="stmt-example-col">
                <div className="stmt-example-label">Входные данные</div>
                <pre className="stmt-example-pre">{inp}</pre>
              </div>
              <div className="stmt-example-col">
                <div className="stmt-example-label">Выходные данные</div>
                <pre className="stmt-example-pre">{out}</pre>
              </div>
            </div>
          ))}
        </section>
      )}
      {form.notes && (
        <section>
          <h3 className="stmt-h3">Примечания</h3>
          <div dangerouslySetInnerHTML={{ __html: html(form.notes) }} />
        </section>
      )}
      {form.interaction && (
        <section>
          <h3 className="stmt-h3">Interaction</h3>
          <div dangerouslySetInnerHTML={{ __html: html(form.interaction) }} />
        </section>
      )}
      {form.scoring && (
        <section>
          <h3 className="stmt-h3">Scoring</h3>
          <div dangerouslySetInnerHTML={{ __html: html(form.scoring) }} />
        </section>
      )}
      {form.tutorial && (
        <section style={{ marginTop: 24, borderTop: '2px solid #e0e0e0', paddingTop: 16 }}>
          <h3 className="stmt-h3" style={{ color: '#555' }}>Tutorial</h3>
          <div dangerouslySetInnerHTML={{ __html: html(form.tutorial) }} />
        </section>
      )}
    </div>
  );
}

export default function StatementTab({ problemId }: Props) {
  const [stmts, setStmts] = useState<Statement[]>([]);
  const [lang, setLang] = useState('russian');
  const [form, setForm] = useState<Form>(EMPTY);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [resources, setResources] = useState<string[]>([]);
  const [uploadingResource, setUploadingResource] = useState(false);
  const [showAddLang, setShowAddLang] = useState(false);
  const [newLangInput, setNewLangInput] = useState('');
  const [examples, setExamples] = useState<string[][]>([]);
  const [activeSection, setActiveSection] = useState<keyof Form>('legend');
  const resourceInputRef = useRef<HTMLInputElement>(null);

  const debouncedForm = useDebounce(form, 250);

  useEffect(() => { reload(); }, [problemId]);
  useEffect(() => { if (lang) { reloadResources(); } }, [lang, problemId]);
  useEffect(() => { loadExamples(); }, [resources, lang, problemId]);

  function reload() {
    problems.statements(problemId).then(list => {
      setStmts(list);
      if (list.length > 0) selectStmt(list[0]);
    });
  }

  function reloadResources() {
    problems.statementResources(problemId, lang).then(setResources).catch(() => setResources([]));
  }

  async function loadExamples() {
    const exList: string[][] = [];
    let i = 1;
    while (true) {
      const numStr = String(i).padStart(2, '0');
      const inName = `example.${numStr}`;
      const outName = `example.${numStr}.a`;
      if (!resources.includes(inName) || !resources.includes(outName)) break;
      try {
        const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
        const inRes = await fetch(`${base}/api/problem.viewStatementResource?problemId=${problemId}&lang=${lang}&name=${inName}`, { credentials: 'include' });
        const outRes = await fetch(`${base}/api/problem.viewStatementResource?problemId=${problemId}&lang=${lang}&name=${outName}`, { credentials: 'include' });
        if (!inRes.ok || !outRes.ok) break;
        exList.push([await inRes.text(), await outRes.text()]);
        i++;
      } catch { break; }
    }
    setExamples(exList);
  }

  function selectStmt(s: Statement) {
    setLang(s.language);
    setForm({ name: s.name, legend: s.legend, input: s.input_section, output: s.output_section,
      scoring: s.scoring, interaction: s.interaction, notes: s.notes, tutorial: s.tutorial });
  }

  function switchLang(newLang: string) {
    setLang(newLang);
    const found = stmts.find(s => s.language === newLang);
    if (found) selectStmt(found);
    else setForm(EMPTY);
  }

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    setMsg(''); setError('');
    try {
      await problems.saveStatement({ problemId, lang, name: form.name, legend: form.legend,
        input: form.input, output: form.output, scoring: form.scoring, interaction: form.interaction,
        notes: form.notes, tutorial: form.tutorial });
      setMsg('Saved');
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  async function handleDeleteCurrent() {
    if (!stmts.find(s => s.language === lang)) return;
    if (!confirm(`Delete statement for "${lang}"?`)) return;
    try {
      await problems.deleteStatement(problemId, lang);
      const remaining = stmts.filter(s => s.language !== lang);
      setStmts(remaining);
      if (remaining.length > 0) selectStmt(remaining[0]);
      else { setLang('russian'); setForm(EMPTY); }
      setMsg(`Statement "${lang}" deleted`);
    } catch (err: unknown) { setError((err as Error).message); }
  }

  async function handleCreateLang() {
    const trimmed = newLangInput.trim().toLowerCase();
    if (!trimmed) return;
    switchLang(trimmed);
    setNewLangInput(''); setShowAddLang(false);
  }

  async function handleUploadResource(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingResource(true);
    try {
      await problems.saveStatementResource(problemId, lang, file);
      reloadResources();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setUploadingResource(false); if (resourceInputRef.current) resourceInputRef.current.value = ''; }
  }

  function set(field: keyof Form) {
    return (v: string) => setForm(f => ({ ...f, [field]: v }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {stmts.map(s => (
          <button key={s.language} className={`btn btn-sm${s.language === lang ? ' btn-primary' : ''}`}
            onClick={() => switchLang(s.language)}>{s.language}</button>
        ))}
        {showAddLang ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <select value={newLangInput} onChange={e => setNewLangInput(e.target.value)} style={{ fontSize: 12, padding: '2px 4px' }}>
              <option value="">-- pick --</option>
              {KNOWN_LANGS.filter(l => !stmts.find(s => s.language === l)).map(l =>
                <option key={l} value={l}>{l}</option>)}
              <option value="__custom__">other...</option>
            </select>
            {newLangInput === '__custom__' && (
              <input autoFocus placeholder="e.g. czech" style={{ width: 80, fontSize: 12, padding: '2px 4px', border: '1px solid #aaa' }}
                onChange={e => setNewLangInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateLang()} />
            )}
            <button className="btn btn-sm btn-primary" onClick={handleCreateLang} disabled={!newLangInput || newLangInput === '__custom__'}>Create</button>
            <button className="btn btn-sm" onClick={() => { setShowAddLang(false); setNewLangInput(''); }}>✕</button>
          </span>
        ) : (
          <button className="btn btn-sm" onClick={() => setShowAddLang(true)}>+ Lang</button>
        )}
        <div style={{ flex: 1 }} />
        {msg && <span style={{ color: '#2a7a2a', fontSize: 12 }}>✓ {msg}</span>}
        {error && <span style={{ color: '#c00', fontSize: 12 }}>✗ {error}</span>}
        {stmts.find(s => s.language === lang) && (
          <button className="btn btn-sm btn-danger" onClick={handleDeleteCurrent}>Delete</button>
        )}
        <button className="btn btn-sm btn-primary" onClick={() => handleSave()}>Save</button>
      </div>

      {/* Split editor */}
      <div style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0, border: '1px solid #ddd', borderRadius: 4, overflow: 'hidden' }}>
        {/* Left: editor */}
        <div style={{ width: '42%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #ddd', background: '#1e1e2e', minHeight: 600 }}>
          {/* Section tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0, borderBottom: '1px solid #333', background: '#181825' }}>
            <div style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: '#a6adc8', fontSize: 11 }}>Name:</span>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #585b70', color: '#cdd6f4',
                  fontFamily: 'monospace', fontSize: 12, outline: 'none', width: 200, padding: '1px 2px' }}
                placeholder="Problem name…" />
            </div>
            <div style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', borderBottom: '1px solid #333', background: '#181825', overflowX: 'auto' }}>
            {SECTIONS.map(s => (
              <button key={s.key} onClick={() => setActiveSection(s.key)}
                style={{ padding: '5px 10px', fontSize: 11, background: activeSection === s.key ? '#1e1e2e' : 'transparent',
                  border: 'none', borderBottom: activeSection === s.key ? '2px solid #89b4fa' : '2px solid transparent',
                  color: activeSection === s.key ? '#89b4fa' : '#6c7086', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {s.label.split(' / ')[0]}
              </button>
            ))}
          </div>
          {/* Active editor */}
          <div style={{ flex: 1, padding: 8, overflow: 'auto' }}>
            {SECTIONS.map(s => activeSection === s.key && (
              <div key={s.key}>
                <div style={{ color: '#6c7086', fontSize: 11, marginBottom: 4 }}>{s.label}</div>
                <LaTeXEditor value={form[s.key]} onChange={set(s.key)} rows={s.rows}
                  placeholder={`${s.label}…`} />
                <div style={{ marginTop: 6, fontSize: 11, color: '#585b70', lineHeight: 1.6 }}>
                  <code style={{ background: '#313244', padding: '1px 4px', borderRadius: 2, color: '#cba6f7' }}>$x$</code> inline &nbsp;
                  <code style={{ background: '#313244', padding: '1px 4px', borderRadius: 2, color: '#cba6f7' }}>$$x$$</code> display &nbsp;
                  <code style={{ background: '#313244', padding: '1px 4px', borderRadius: 2, color: '#a6e3a1' }}>\textbf{'{}'}</code>&nbsp;
                  <code style={{ background: '#313244', padding: '1px 4px', borderRadius: 2, color: '#a6e3a1' }}>\textit{'{}'}</code>&nbsp;
                  <code style={{ background: '#313244', padding: '1px 4px', borderRadius: 2, color: '#a6e3a1' }}>\texttt{'{}'}</code>&nbsp;
                  Tab = 2 spaces
                </div>
              </div>
            ))}
          </div>

          {/* Resource files at bottom */}
          <details style={{ borderTop: '1px solid #333', background: '#181825' }}>
            <summary style={{ padding: '6px 10px', fontSize: 11, color: '#6c7086', cursor: 'pointer', listStyle: 'none' }}>
              ▸ Resources ({resources.length})
            </summary>
            <div style={{ padding: '6px 10px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {resources.map(name => (
                  <a key={name} style={{ fontSize: 10, color: '#89b4fa', fontFamily: 'monospace',
                    background: '#313244', padding: '2px 6px', borderRadius: 2, textDecoration: 'none' }}
                    href={`/api/problem.viewStatementResource?problemId=${problemId}&lang=${lang}&name=${encodeURIComponent(name)}`}
                    target="_blank" rel="noreferrer">{name}</a>
                ))}
                {resources.length === 0 && <span style={{ color: '#585b70', fontSize: 11 }}>No files</span>}
              </div>
              <label className="btn btn-sm" style={{ cursor: 'pointer', fontSize: 11, background: '#313244', border: '1px solid #45475a', color: '#cdd6f4' }}>
                {uploadingResource ? 'Uploading…' : '+ Upload'}
                <input ref={resourceInputRef} type="file" style={{ display: 'none' }} onChange={handleUploadResource} disabled={uploadingResource} />
              </label>
            </div>
          </details>
        </div>

        {/* Right: preview */}
        <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
          <StatementPreview form={debouncedForm} examples={examples} />
        </div>
      </div>
    </div>
  );
}
