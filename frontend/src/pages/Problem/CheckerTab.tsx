import React, { useState, useEffect, useRef } from 'react';
import { problems, Asset, ProblemInfo, CheckerTest } from '../../api/client';

interface Props { problemId: number; info: ProblemInfo; onUpdate: () => void; }

export default function CheckerTab({ problemId, info, onUpdate }: Props) {
  const [checker, setChecker] = useState<Asset | null>(null);
  const [sourcePath, setSourcePath] = useState('');
  const [sourceType, setSourceType] = useState('cpp.g++17');
  const [name, setName] = useState('');
  const [checkerType, setCheckerType] = useState('testlib');
  const [content, setContent] = useState('');
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
    reader.onload = () => {
      setContent(reader.result as string);
      if (!sourcePath) setSourcePath('files/' + file.name);
    };
    reader.readAsText(file);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      if (sourcePath && content) {
        await problems.saveFile({ problemId, path: sourcePath, sourceType, content });
      }
      await problems.setChecker({ problemId, sourcePath, sourceType, name, type: checkerType });
      setMsg('Checker saved');
      setContent('');
      if (fileRef.current) fileRef.current.value = '';
      reload(); onUpdate();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function addTest(e: React.FormEvent) {
    e.preventDefault();
    try {
      await problems.saveCheckerTest({ problemId, ...newTest, expectedVerdict: newTest.verdict });
      setNewTest({ input: '', output: '', answer: '', verdict: 'OK' });
      reload();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h2>Checker</h2>
      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {checker && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f4f4f4', border: '1px solid #ddd' }}>
          <strong>Current checker:</strong> <span className="source-type">{checker.source_path}</span>
          {' '}(<span className="source-type">{checker.source_type}</span>)
          {checker.name && <> — {checker.name}</>}
        </div>
      )}

      <form onSubmit={handleSave} style={{ marginBottom: 16 }}>
        <div className="section-header">Set Checker</div>
        <div className="form-row">
          <label>Upload file:</label>
          <input ref={fileRef} type="file" accept=".cpp,.py,.java,.pas,.c,.go" onChange={handleFile}
            style={{ fontSize: 12 }} />
        </div>
        <div className="form-row">
          <label>Source path:</label>
          <input type="text" value={sourcePath} onChange={e => setSourcePath(e.target.value)}
            placeholder="files/check.cpp" style={{ width: 260 }} />
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
          <label>Name (optional):</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} style={{ width: 200 }} />
        </div>
        <div className="form-row">
          <label>Type:</label>
          <select value={checkerType} onChange={e => setCheckerType(e.target.value)}>
            <option value="testlib">testlib</option>
            <option value="custom">custom</option>
          </select>
        </div>
        {content && (
          <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <label style={{ marginBottom: 4 }}>Content preview (will be saved to {sourcePath}):</label>
            <div className="code-view" style={{ maxHeight: 120 }}>{content.slice(0, 500)}{content.length > 500 ? '…' : ''}</div>
          </div>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">Set Checker</button>
        </div>
      </form>

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
          {tests.length === 0 && <tr><td colSpan={6} style={{ color: '#888' }}>No checker tests</td></tr>}
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
