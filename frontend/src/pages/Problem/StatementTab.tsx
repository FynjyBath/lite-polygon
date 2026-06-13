import React, { useState, useEffect } from 'react';
import { problems, Statement } from '../../api/client';

interface Props { problemId: number; }

export default function StatementTab({ problemId }: Props) {
  const [stmts, setStmts] = useState<Statement[]>([]);
  const [selected, setSelected] = useState<Statement | null>(null);
  const [lang, setLang] = useState('russian');
  const [form, setForm] = useState({ name: '', legend: '', input: '', output: '', scoring: '', interaction: '', notes: '', tutorial: '' });
  const [preview, setPreview] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [activeField, setActiveField] = useState<'statement' | 'tutorial'>('statement');

  useEffect(() => { reload(); }, [problemId]);

  function reload() {
    problems.statements(problemId).then(list => {
      setStmts(list);
      if (list.length > 0) selectStmt(list[0]);
    });
  }

  function selectStmt(s: Statement) {
    setSelected(s);
    setLang(s.language);
    setForm({
      name: s.name, legend: s.legend, input: s.input_section, output: s.output_section,
      scoring: s.scoring, interaction: s.interaction, notes: s.notes, tutorial: s.tutorial,
    });
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

  async function handlePreview() {
    try {
      const result = await problems.renderStatements(problemId, lang);
      setPreview(activeField === 'tutorial' ? result.tutorialHtml : result.html);
    } catch (err: unknown) {
      setPreview('<em>' + (err as Error).message + '</em>');
    }
  }

  function f(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, [field]: e.target.value });
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <h2>Statement</h2>
        <div className="flex">
          <select value={lang} onChange={e => {
            setLang(e.target.value);
            const found = stmts.find(s => s.language === e.target.value);
            if (found) selectStmt(found);
            else setForm({ name: '', legend: '', input: '', output: '', scoring: '', interaction: '', notes: '', tutorial: '' });
          }}>
            <option value="russian">Russian</option>
            <option value="english">English</option>
            <option value="chinese">Chinese</option>
          </select>
          {stmts.filter(s => s.language !== lang).map(s => (
            <button key={s.language} className="btn btn-sm" onClick={() => selectStmt(s)}>
              {s.language}
            </button>
          ))}
        </div>
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
            {(['legend', 'input', 'output', 'scoring', 'interaction', 'notes'] as const).map(field => (
              <div key={field} className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                <label style={{ marginBottom: 4, textTransform: 'capitalize' }}>{field}:</label>
                <textarea
                  value={form[field]}
                  onChange={f(field)}
                  style={{ width: '100%', minHeight: field === 'legend' ? 120 : 60 }}
                />
              </div>
            ))}
            <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <label style={{ marginBottom: 4 }}>Tutorial:</label>
              <textarea value={form.tutorial} onChange={f('tutorial')} style={{ width: '100%', minHeight: 80 }} />
            </div>
            <div className="form-actions flex">
              <button type="submit" className="btn btn-primary">Save</button>
              <button type="button" className="btn" onClick={handlePreview}>Preview</button>
            </div>
          </form>
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
