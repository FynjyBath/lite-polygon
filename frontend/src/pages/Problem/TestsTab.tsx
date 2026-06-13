import React, { useState, useEffect } from 'react';
import { problems, TestPreview, ProblemInfo } from '../../api/client';

interface Props { problemId: number; info: ProblemInfo; }

export default function TestsTab({ problemId, info }: Props) {
  const [tests, setTests] = useState<TestPreview[]>([]);
  const [newTest, setNewTest] = useState({ method: 'manual', input: '', cmd: '', description: '', sample: false, group: '', points: '0' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [viewInput, setViewInput] = useState<{ idx: number; content: string } | null>(null);

  useEffect(() => { reload(); }, [problemId]);

  function reload() {
    problems.previewTests(problemId).then(setTests).catch(e => setError(e.message));
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      await problems.saveTest({
        problemId,
        method: newTest.method,
        input: newTest.method === 'manual' ? newTest.input : undefined,
        cmd: newTest.method === 'generated' ? newTest.cmd : undefined,
        scriptLine: newTest.method === 'generated' ? newTest.cmd : undefined,
        description: newTest.description,
        sample: String(newTest.sample),
        group: newTest.group,
        points: newTest.points,
      });
      setNewTest({ method: 'manual', input: '', cmd: '', description: '', sample: false, group: '', points: '0' });
      setMsg('Test added');
      reload();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(idx: number) {
    if (!confirm(`Delete test ${idx}?`)) return;
    try {
      await problems.deleteTest(problemId, idx);
      reload();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function handleGenerateAnswers() {
    setMsg(''); setError('');
    try {
      const res = await problems.generateAnswers(problemId);
      setMsg(`Generated ${res.generated} answer(s)${res.errors.length ? '; errors: ' + res.errors.join(', ') : ''}`);
      reload();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function handleViewInput(idx: number) {
    try {
      const url = problems.testInput(problemId, idx);
      const res = await fetch(url, { credentials: 'include' });
      const text = await res.text();
      setViewInput({ idx, content: text.slice(0, 2000) });
    } catch {
      setViewInput({ idx, content: 'Failed to load' });
    }
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <h2>Tests</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#666', fontSize: 12 }}>{tests.length} test(s)</span>
          <button className="btn btn-sm" onClick={handleGenerateAnswers}>Generate Answers</button>
        </div>
      </div>

      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <table className="poly-table" style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th>#</th><th>Method</th><th>Sample</th><th>Group</th><th>Points</th>
            <th>Cmd/Description</th><th>Input</th><th>Answer</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tests.map(t => (
            <tr key={t.idx}>
              <td>{t.idx}</td>
              <td>{t.method}</td>
              <td>{t.sample ? '✓' : ''}</td>
              <td>{t.group_name}</td>
              <td>{t.points > 0 ? t.points : ''}</td>
              <td>
                {t.method === 'generated'
                  ? <span className="source-type">{t.cmd}</span>
                  : t.description || ''}
              </td>
              <td>
                {t.inputAvailable
                  ? <button className="btn btn-sm" onClick={() => handleViewInput(t.idx)}>View</button>
                  : <span style={{ color: '#888', fontSize: 11 }}>missing</span>}
              </td>
              <td>
                {t.answerAvailable
                  ? <a href={problems.testAnswer(problemId, t.idx)} target="_blank" rel="noreferrer" className="btn btn-sm">View</a>
                  : <span style={{ color: '#888', fontSize: 11 }}>missing</span>}
              </td>
              <td>
                <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t.idx)}>Del</button>
              </td>
            </tr>
          ))}
          {tests.length === 0 && <tr><td colSpan={9} style={{ color: '#888' }}>No tests</td></tr>}
        </tbody>
      </table>

      {viewInput && (
        <div style={{ marginBottom: 12 }}>
          <div className="flex-between" style={{ marginBottom: 4 }}>
            <strong>Test {viewInput.idx} input:</strong>
            <button className="btn btn-sm" onClick={() => setViewInput(null)}>Close</button>
          </div>
          <div className="code-view">{viewInput.content}</div>
        </div>
      )}

      <div className="section-header">Add Test</div>
      <form onSubmit={handleAdd}>
        <div className="form-row">
          <label>Method:</label>
          <select value={newTest.method} onChange={e => setNewTest({ ...newTest, method: e.target.value })}>
            <option value="manual">Manual</option>
            <option value="generated">Generated</option>
          </select>
        </div>
        {newTest.method === 'manual' ? (
          <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <label>Input:</label>
            <textarea
              value={newTest.input}
              onChange={e => setNewTest({ ...newTest, input: e.target.value })}
              style={{ width: '100%', minHeight: 80 }}
            />
          </div>
        ) : (
          <div className="form-row">
            <label>Generator command:</label>
            <input type="text" value={newTest.cmd} onChange={e => setNewTest({ ...newTest, cmd: e.target.value })}
              placeholder="gen rand 100 100000 42" style={{ width: 300 }} />
          </div>
        )}
        <div className="form-row">
          <label>Description:</label>
          <input type="text" value={newTest.description} onChange={e => setNewTest({ ...newTest, description: e.target.value })} style={{ width: 200 }} />
        </div>
        <div className="form-row">
          <label>Sample:</label>
          <input type="checkbox" checked={newTest.sample} onChange={e => setNewTest({ ...newTest, sample: e.target.checked })} />
        </div>
        <div className="form-row">
          <label>Group:</label>
          <input type="text" value={newTest.group} onChange={e => setNewTest({ ...newTest, group: e.target.value })} style={{ width: 80 }} />
        </div>
        <div className="form-row">
          <label>Points:</label>
          <input type="number" value={newTest.points} onChange={e => setNewTest({ ...newTest, points: e.target.value })} style={{ width: 80 }} />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">Add Test</button>
        </div>
      </form>
    </div>
  );
}
