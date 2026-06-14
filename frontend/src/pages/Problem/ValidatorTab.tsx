import React, { useState, useEffect, useRef } from 'react';
import { problems, Asset, ProblemInfo, ValidatorTest } from '../../api/client';

interface Props { problemId: number; info: ProblemInfo; onUpdate: () => void; }

export default function ValidatorTab({ problemId, info, onUpdate }: Props) {
  const [validator, setValidator] = useState<Asset | null>(null);
  const [sourceType, setSourceType] = useState('cpp.g++17');
  const [content, setContent] = useState('');
  const [derivedPath, setDerivedPath] = useState('');
  const [tests, setTests] = useState<ValidatorTest[]>([]);
  const [newTest, setNewTest] = useState({ input: '', verdict: 'VALID' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { reload(); }, [problemId]);

  function reload() {
    problems.validator(problemId).then(setValidator);
    problems.validatorTests(problemId).then(setTests);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setContent(reader.result as string);
    reader.readAsText(file);
    setDerivedPath('files/' + file.name);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      if (derivedPath && content) {
        await problems.saveFile({ problemId, path: derivedPath, sourceType, content });
      }
      await problems.setValidator({ problemId, sourcePath: derivedPath, sourceType });
      setMsg('Validator saved');
      setContent('');
      setDerivedPath('');
      if (fileRef.current) fileRef.current.value = '';
      reload(); onUpdate();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function addTest(e: React.FormEvent) {
    e.preventDefault();
    try {
      await problems.saveValidatorTest({ problemId, input: newTest.input, expectedVerdict: newTest.verdict });
      setNewTest({ input: '', verdict: 'VALID' });
      reload();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h2>Validator</h2>
      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {validator && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f4f4f4', border: '1px solid #ddd' }}>
          <strong>Current validator:</strong> <span className="source-type">{validator.source_path}</span>
          {' '}(<span className="source-type">{validator.source_type}</span>)
        </div>
      )}

      <form onSubmit={handleSave} style={{ marginBottom: 16 }}>
        <div className="section-header">Set Validator</div>
        <div className="form-row">
          <label>Upload file:</label>
          <input ref={fileRef} type="file" accept=".cpp,.py,.java,.pas,.c,.go" onChange={handleFile}
            style={{ fontSize: 12 }} />
        </div>
        {derivedPath && (
          <div className="form-row">
            <label>Will save to:</label>
            <span style={{ fontSize: 12, color: '#555', fontFamily: 'monospace' }}>{derivedPath}</span>
          </div>
        )}
        <div className="form-row">
          <label>Source type:</label>
          <select value={sourceType} onChange={e => setSourceType(e.target.value)}>
            <option value="cpp.g++17">cpp.g++17</option>
            <option value="cpp.g++20">cpp.g++20</option>
            <option value="cpp.gcc14-64-msys2-g++23">cpp.gcc14-64-msys2-g++23</option>
          </select>
        </div>
        {content && (
          <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <label style={{ marginBottom: 4 }}>Content preview:</label>
            <div className="code-view" style={{ maxHeight: 120 }}>{content.slice(0, 500)}{content.length > 500 ? '…' : ''}</div>
          </div>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">Set Validator</button>
        </div>
      </form>

      <div className="section-header">Validator Tests</div>
      <table className="poly-table" style={{ marginBottom: 8 }}>
        <thead>
          <tr><th>#</th><th>Input</th><th>Expected</th><th>Result</th><th>Comment</th></tr>
        </thead>
        <tbody>
          {tests.map(t => (
            <tr key={t.id}>
              <td>{t.idx}</td>
              <td><div className="input-preview">{t.input}</div></td>
              <td style={{ color: t.expected_verdict === 'VALID' ? 'green' : 'red' }}>{t.expected_verdict}</td>
              <td className={t.run_verdict === t.expected_verdict ? 'verdict-OK' : 'verdict-WA'}>
                {t.run_verdict || '—'}
              </td>
              <td style={{ fontSize: 11, color: '#666' }}>{t.run_comment}</td>
            </tr>
          ))}
          {tests.length === 0 && <tr><td colSpan={5} style={{ color: '#888' }}>No validator tests</td></tr>}
        </tbody>
      </table>

      <form onSubmit={addTest}>
        <div className="section-header">Add Validator Test</div>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <label>Input:</label>
          <textarea value={newTest.input} onChange={e => setNewTest({ ...newTest, input: e.target.value })} style={{ width: 400 }} />
        </div>
        <div className="form-row">
          <label>Expected verdict:</label>
          <select value={newTest.verdict} onChange={e => setNewTest({ ...newTest, verdict: e.target.value })}>
            <option value="VALID">VALID</option>
            <option value="INVALID">INVALID</option>
          </select>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn">Add Test</button>
        </div>
      </form>
    </div>
  );
}
