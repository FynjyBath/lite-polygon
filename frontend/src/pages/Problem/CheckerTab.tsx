import React, { useState, useEffect, useRef } from 'react';
import { problems, Asset, ProblemInfo, CheckerTest } from '../../api/client';
import CodeEditor from '../../components/CodeEditor';

interface Props { problemId: number; info: ProblemInfo; onUpdate: () => void; }

const STANDARD_CHECKERS = [
  { name: 'std::ncmp.cpp',  desc: 'Sequence of integers (long long)' },
  { name: 'std::icmp.cpp',  desc: 'Single integer' },
  { name: 'std::wcmp.cpp',  desc: 'Sequence of tokens (case-sensitive)' },
  { name: 'std::yesno.cpp', desc: 'Single YES or NO (case-insensitive)' },
  { name: 'std::nyesno.cpp',desc: 'N lines of YES or NO (case-insensitive)' },
  { name: 'std::fcmp.cpp',  desc: 'Lines of tokens (flexible whitespace)' },
  { name: 'std::lcmp.cpp',  desc: 'Lines (trim trailing whitespace)' },
  { name: 'std::rcmp.cpp',  desc: 'Real numbers (1e-6 tolerance)' },
  { name: 'std::rcmp4.cpp', desc: 'Real numbers (1e-4 tolerance)' },
  { name: 'std::rcmp6.cpp', desc: 'Real numbers (1e-6 tolerance)' },
  { name: 'std::rcmp9.cpp', desc: 'Real numbers (1e-9 tolerance)' },
];

export default function CheckerTab({ problemId, info, onUpdate }: Props) {
  const [checker, setChecker] = useState<Asset | null>(null);
  const [mode, setMode] = useState<'standard' | 'custom'>('standard');
  const [stdChecker, setStdChecker] = useState(STANDARD_CHECKERS[0].name);
  const [sourceType, setSourceType] = useState('cpp.g++17');
  const [checkerType, setCheckerType] = useState('testlib');
  const [content, setContent] = useState('');
  const [derivedPath, setDerivedPath] = useState('');
  const [tests, setTests] = useState<CheckerTest[]>([]);
  const [newTest, setNewTest] = useState({ input: '', output: '', answer: '', verdict: 'OK' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { reload(); }, [problemId]);

  function reload() {
    problems.checker(problemId).then(setChecker);
    problems.checkerTests(problemId).then(setTests);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setContent(reader.result as string);
    reader.readAsText(file);
    setDerivedPath('files/' + file.name);
  }

  async function handleSaveStandard(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      await problems.setChecker({ problemId, sourcePath: stdChecker, sourceType: 'cpp.g++17', name: stdChecker, type: 'testlib' });
      setMsg(`Standard checker ${stdChecker} set`);
      reload(); onUpdate();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  async function handleSaveCustom(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      if (derivedPath && content) {
        await problems.saveFile({ problemId, path: derivedPath, sourceType, content });
      }
      await problems.setChecker({ problemId, sourcePath: derivedPath, sourceType, name: '', type: checkerType });
      setMsg('Custom checker saved');
      setContent('');
      setDerivedPath('');
      if (fileRef.current) fileRef.current.value = '';
      reload(); onUpdate();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  async function addTest(e: React.FormEvent) {
    e.preventDefault();
    try {
      await problems.saveCheckerTest({ problemId, ...newTest, expectedVerdict: newTest.verdict });
      setNewTest({ input: '', output: '', answer: '', verdict: 'OK' });
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  return (
    <div>
      <h2>Checker</h2>
      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {checker && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <strong>Current checker:</strong>{' '}
          <span className="source-type">{checker.name || checker.source_path}</span>
          {' '}(<span className="source-type">{checker.source_type || 'testlib'}</span>)
        </div>
      )}

      <div style={{ display: 'flex', gap: 0, marginBottom: 12 }}>
        <button
          className={`btn btn-sm${mode === 'standard' ? ' btn-primary' : ''}`}
          style={{ borderRadius: '4px 0 0 4px' }}
          onClick={() => setMode('standard')}
        >Standard Checker</button>
        <button
          className={`btn btn-sm${mode === 'custom' ? ' btn-primary' : ''}`}
          style={{ borderRadius: '0 4px 4px 0' }}
          onClick={() => setMode('custom')}
        >Custom Checker</button>
      </div>

      {mode === 'standard' ? (
        <form onSubmit={handleSaveStandard} style={{ marginBottom: 16 }}>
          <div className="section-header">Select Standard Checker</div>
          <div className="form-row">
            <label>Checker:</label>
            <select value={stdChecker} onChange={e => setStdChecker(e.target.value)} style={{ width: 320 }}>
              {STANDARD_CHECKERS.map(c => (
                <option key={c.name} value={c.name}>{c.name} — {c.desc}</option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 120, marginBottom: 8 }}>
            Standard checkers require the checker file to be present in the <code>files/</code> directory
            (e.g., from an imported Polygon package).
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">Use Standard Checker</button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleSaveCustom} style={{ marginBottom: 16 }}>
          <div className="section-header">Upload Custom Checker</div>
          <div className="form-row">
            <label>Upload file:</label>
            <input ref={fileRef} type="file" accept=".cpp,.py,.java,.pas,.c,.go" onChange={handleFile}
              style={{ fontSize: 12 }} />
          </div>
          <div className="form-row">
            <label>File path:</label>
            <input value={derivedPath} onChange={e => setDerivedPath(e.target.value)}
              placeholder="files/checker.cpp" style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
          </div>
          <div className="form-row">
            <label>Source type:</label>
            <select value={sourceType} onChange={e => setSourceType(e.target.value)}>
              <option value="cpp.g++17">cpp.g++17</option>
              <option value="cpp.g++20">cpp.g++20</option>
              <option value="cpp.gcc14-64-msys2-g++23">cpp.gcc14-64-msys2-g++23</option>
            </select>
          </div>
          <div className="form-row">
            <label>Type:</label>
            <select value={checkerType} onChange={e => setCheckerType(e.target.value)}>
              <option value="testlib">testlib</option>
              <option value="custom">custom</option>
            </select>
          </div>
          <div className="form-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <label style={{ marginBottom: 4 }}>Checker source:</label>
            <CodeEditor value={content} onChange={setContent} sourceType={sourceType} height={360} />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={!derivedPath}>Set Custom Checker</button>
          </div>
        </form>
      )}

      <div className="section-header">Checker Tests</div>
      <table className="poly-table" style={{ marginBottom: 8 }}>
        <thead>
          <tr><th>#</th><th>Input</th><th>Output</th><th>Answer</th><th>Expected</th><th>Result</th></tr>
        </thead>
        <tbody>
          {tests.map(t => (
            <tr key={t.id}>
              <td>{t.idx}</td>
              <td><div className="input-preview">{t.input}</div></td>
              <td><div className="input-preview">{t.output_data}</div></td>
              <td><div className="input-preview">{t.answer}</div></td>
              <td>{t.expected_verdict}</td>
              <td className={`verdict-${t.run_verdict}`}>{t.run_verdict || '—'}</td>
            </tr>
          ))}
          {tests.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>No checker tests</td></tr>}
        </tbody>
      </table>

      <form onSubmit={addTest}>
        <div className="section-header">Add Checker Test</div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <label>Input:</label>
          <textarea value={newTest.input} onChange={e => setNewTest({ ...newTest, input: e.target.value })} style={{ width: 400 }} />
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <label>Output (participant):</label>
          <textarea value={newTest.output} onChange={e => setNewTest({ ...newTest, output: e.target.value })} style={{ width: 400 }} />
        </div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <label>Answer (correct):</label>
          <textarea value={newTest.answer} onChange={e => setNewTest({ ...newTest, answer: e.target.value })} style={{ width: 400 }} />
        </div>
        <div className="form-row">
          <label>Expected verdict:</label>
          <select value={newTest.verdict} onChange={e => setNewTest({ ...newTest, verdict: e.target.value })}>
            <option value="OK">OK</option>
            <option value="WRONG_ANSWER">WRONG_ANSWER</option>
            <option value="PRESENTATION_ERROR">PRESENTATION_ERROR</option>
            <option value="CRASHED">CRASHED</option>
          </select>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn">Add Test</button>
        </div>
      </form>
    </div>
  );
}
