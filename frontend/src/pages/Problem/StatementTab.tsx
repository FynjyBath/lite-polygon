import React, { useState, useEffect, useRef, useCallback } from 'react';
import { problems, Statement } from '../../api/client';
import { latexToHtml } from '../../utils/latexToHtml';
import 'katex/dist/katex.min.css';

interface Props { problemId: number; }

type Form = { name: string; legend: string; input: string; output: string; scoring: string; interaction: string; notes: string; tutorial: string };
const EMPTY: Form = { name: '', legend: '', input: '', output: '', scoring: '', interaction: '', notes: '', tutorial: '' };
const KNOWN_LANGS = ['russian', 'english', 'chinese'];

const SECTIONS: { key: keyof Form; label: string; short: string }[] = [
  { key: 'legend',      label: 'Условие / Legend',           short: 'Legend' },
  { key: 'input',       label: 'Входные данные / Input',     short: 'Input' },
  { key: 'output',      label: 'Выходные данные / Output',   short: 'Output' },
  { key: 'interaction', label: 'Interaction',                 short: 'Interact' },
  { key: 'notes',       label: 'Примечания / Notes',         short: 'Notes' },
  { key: 'scoring',     label: 'Scoring',                     short: 'Scoring' },
  { key: 'tutorial',    label: 'Tutorial / Разбор',          short: 'Tutorial' },
];

function useDebounce<T>(value: T, ms: number): T {
  const [dv, setDv] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDv(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return dv;
}

function LaTeXEditor({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = el;
      const next = el.value.slice(0, s) + '  ' + el.value.slice(end);
      onChange(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    }
  }
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      style={{
        width: '100%', flex: 1,
        fontFamily: '"Fira Code", "Consolas", "Courier New", monospace',
        fontSize: 13, lineHeight: 1.6, resize: 'none',
        border: '1px solid #d0d7de', borderRadius: 4, padding: '10px 12px',
        background: '#fff', color: '#1f2328', outline: 'none',
        boxSizing: 'border-box', display: 'block',
      }}
    />
  );
}

function StatementPreview({ form, examples }: { form: Form; examples: string[][] }) {
  const html = useCallback((text: string) => latexToHtml(text), []);
  const hasContent = Object.values(form).some(v => v.trim());
  if (!hasContent) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontSize: 13 }}>
      Начните вводить текст — предпросмотр появится здесь
    </div>
  );
  return (
    <div className="stmt-preview">
      {form.name && <h1 className="stmt-title">{form.name}</h1>}
      {form.legend && (
        <section className="stmt-section">
          <div className="stmt-body" dangerouslySetInnerHTML={{ __html: html(form.legend) }} />
        </section>
      )}
      {form.input && (
        <section className="stmt-section">
          <h3 className="stmt-h3">Входные данные</h3>
          <div className="stmt-body" dangerouslySetInnerHTML={{ __html: html(form.input) }} />
        </section>
      )}
      {form.output && (
        <section className="stmt-section">
          <h3 className="stmt-h3">Выходные данные</h3>
          <div className="stmt-body" dangerouslySetInnerHTML={{ __html: html(form.output) }} />
        </section>
      )}
      {examples.length > 0 && (
        <section className="stmt-section">
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
        <section className="stmt-section">
          <h3 className="stmt-h3">Примечания</h3>
          <div className="stmt-body" dangerouslySetInnerHTML={{ __html: html(form.notes) }} />
        </section>
      )}
      {form.interaction && (
        <section className="stmt-section">
          <h3 className="stmt-h3">Interaction</h3>
          <div className="stmt-body" dangerouslySetInnerHTML={{ __html: html(form.interaction) }} />
        </section>
      )}
      {form.scoring && (
        <section className="stmt-section">
          <h3 className="stmt-h3">Scoring</h3>
          <div className="stmt-body" dangerouslySetInnerHTML={{ __html: html(form.scoring) }} />
        </section>
      )}
      {form.tutorial && (
        <section className="stmt-section stmt-tutorial">
          <h3 className="stmt-h3">Tutorial</h3>
          <div className="stmt-body" dangerouslySetInnerHTML={{ __html: html(form.tutorial) }} />
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
  useEffect(() => { if (lang) reloadResources(); }, [lang, problemId]);
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
        const [inRes, outRes] = await Promise.all([
          fetch(`${base}/api/problem.viewStatementResource?problemId=${problemId}&lang=${lang}&name=${inName}`, { credentials: 'include' }),
          fetch(`${base}/api/problem.viewStatementResource?problemId=${problemId}&lang=${lang}&name=${outName}`, { credentials: 'include' }),
        ]);
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

  async function handleSave() {
    setMsg(''); setError('');
    try {
      await problems.saveStatement({ problemId, lang, name: form.name, legend: form.legend,
        input: form.input, output: form.output, scoring: form.scoring, interaction: form.interaction,
        notes: form.notes, tutorial: form.tutorial });
      setMsg('Saved'); reload();
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
    if (!trimmed || trimmed === '__custom__') return;
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

  const set = (field: keyof Form) => (v: string) => setForm(f => ({ ...f, [field]: v }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top toolbar */}
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
              <option value="__custom__">other…</option>
            </select>
            {newLangInput === '__custom__' && (
              <input autoFocus placeholder="e.g. czech" style={{ width: 80, fontSize: 12, padding: '2px 4px', border: '1px solid #aaa' }}
                onChange={e => setNewLangInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateLang()} />
            )}
            <button className="btn btn-sm btn-primary" onClick={handleCreateLang}
              disabled={!newLangInput || newLangInput === '__custom__'}>Create</button>
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
        <button className="btn btn-sm btn-primary" onClick={handleSave}>Save</button>
      </div>

      {/* 50/50 split pane */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, border: '1px solid #d0d7de', borderRadius: 4, overflow: 'hidden' }}>

        {/* Left: editor */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #d0d7de', background: '#fff', minHeight: 600 }}>
          {/* Name field */}
          <div style={{ padding: '7px 12px', borderBottom: '1px solid #e8eaed', background: '#f6f8fa', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#666', whiteSpace: 'nowrap' }}>Название:</span>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Название задачи…"
              style={{ flex: 1, border: '1px solid #d0d7de', borderRadius: 4, padding: '3px 8px',
                fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#fff', color: '#1f2328' }}
            />
          </div>

          {/* Section tabs */}
          <div style={{ display: 'flex', background: '#f6f8fa', borderBottom: '1px solid #e8eaed', overflowX: 'auto', flexShrink: 0 }}>
            {SECTIONS.map(s => (
              <button key={s.key} onClick={() => setActiveSection(s.key)} style={{
                padding: '6px 12px', fontSize: 12, background: 'transparent', border: 'none',
                borderBottom: activeSection === s.key ? '2px solid #0969da' : '2px solid transparent',
                color: activeSection === s.key ? '#0969da' : '#57606a',
                fontWeight: activeSection === s.key ? 600 : 400,
                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {s.short}
              </button>
            ))}
          </div>

          {/* Textarea area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '10px 12px', overflow: 'hidden' }}>
            {SECTIONS.map(s => activeSection === s.key && (
              <React.Fragment key={s.key}>
                <LaTeXEditor value={form[s.key]} onChange={set(s.key)} placeholder={`${s.label}…`} />
                <div style={{ marginTop: 6, fontSize: 11, color: '#8c959f', lineHeight: 1.8, flexShrink: 0 }}>
                  <code style={{ background: '#f0f4f8', border: '1px solid #d0d7de', padding: '0 4px', borderRadius: 3, fontSize: 11 }}>$x$</code>{' '}инлайн{'  '}
                  <code style={{ background: '#f0f4f8', border: '1px solid #d0d7de', padding: '0 4px', borderRadius: 3, fontSize: 11 }}>$$x$$</code>{' '}блок{'  '}
                  <code style={{ background: '#f0f4f8', border: '1px solid #d0d7de', padding: '0 4px', borderRadius: 3, fontSize: 11 }}>\textbf{'{}'}</code>{'  '}
                  <code style={{ background: '#f0f4f8', border: '1px solid #d0d7de', padding: '0 4px', borderRadius: 3, fontSize: 11 }}>\textit{'{}'}</code>{'  '}
                  <code style={{ background: '#f0f4f8', border: '1px solid #d0d7de', padding: '0 4px', borderRadius: 3, fontSize: 11 }}>\texttt{'{}'}</code>{'  '}
                  Tab = 2 пробела
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Resources */}
          <details style={{ borderTop: '1px solid #e8eaed', background: '#f6f8fa', flexShrink: 0 }}>
            <summary style={{ padding: '6px 12px', fontSize: 11, color: '#57606a', cursor: 'pointer', listStyle: 'none', userSelect: 'none' }}>
              ▸ Ресурсы ({resources.length})
            </summary>
            <div style={{ padding: '6px 12px 10px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {resources.map(name => (
                  <a key={name} style={{ fontSize: 11, color: '#0969da', fontFamily: 'monospace',
                    background: '#ddf4ff', border: '1px solid #b6e3ff', padding: '1px 6px', borderRadius: 3, textDecoration: 'none' }}
                    href={`/api/problem.viewStatementResource?problemId=${problemId}&lang=${lang}&name=${encodeURIComponent(name)}`}
                    target="_blank" rel="noreferrer">{name}</a>
                ))}
                {resources.length === 0 && <span style={{ color: '#999', fontSize: 11 }}>Нет файлов</span>}
              </div>
              <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                {uploadingResource ? 'Загрузка…' : '+ Загрузить'}
                <input ref={resourceInputRef} type="file" style={{ display: 'none' }} onChange={handleUploadResource} disabled={uploadingResource} />
              </label>
            </div>
          </details>
        </div>

        {/* Right: preview */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', background: '#fff' }}>
          {/* Preview header */}
          <div style={{ padding: '6px 20px', borderBottom: '1px solid #e8eaed', background: '#f6f8fa',
            fontSize: 11, color: '#57606a', letterSpacing: '0.02em', textTransform: 'uppercase', fontWeight: 600 }}>
            Предпросмотр
          </div>
          <StatementPreview form={debouncedForm} examples={examples} />
        </div>
      </div>
    </div>
  );
}
