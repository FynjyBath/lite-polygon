import React, { useState, useEffect } from 'react';
import { problems, Stress } from '../../api/client';

interface Props { problemId: number; }

export default function StressesTab({ problemId }: Props) {
  const [stresses, setStresses] = useState<Stress[]>([]);
  const [form, setForm] = useState({ name: '', generatorCmd: '', solutionPath: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    problems.stresses(problemId).then(setStresses).catch(e => setError(e.message));
  }, [problemId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      await problems.saveStress({ problemId, ...form });
      setMsg('Stress saved');
      setForm({ name: '', generatorCmd: '', solutionPath: '' });
      problems.stresses(problemId).then(setStresses);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h2>Stresses</h2>
      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <table className="poly-table" style={{ marginBottom: 12 }}>
        <thead>
          <tr><th>#</th><th>Name</th><th>Generator Command</th><th>Solution Path</th></tr>
        </thead>
        <tbody>
          {stresses.map(s => (
            <tr key={s.id}>
              <td>{s.id}</td>
              <td>{s.name}</td>
              <td><span className="source-type">{s.generator_cmd}</span></td>
              <td><span className="source-type">{s.solution_path}</span></td>
            </tr>
          ))}
          {stresses.length === 0 && <tr><td colSpan={4} style={{ color: '#888' }}>No stresses</td></tr>}
        </tbody>
      </table>

      <div className="section-header">Add Stress</div>
      <form onSubmit={handleSave}>
        <div className="form-row">
          <label>Name:</label>
          <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ width: 200 }} />
        </div>
        <div className="form-row">
          <label>Generator command:</label>
          <input type="text" value={form.generatorCmd} onChange={e => setForm({ ...form, generatorCmd: e.target.value })}
            placeholder="gen rand $" style={{ width: 280 }} />
        </div>
        <div className="form-row">
          <label>Tested solution path:</label>
          <input type="text" value={form.solutionPath} onChange={e => setForm({ ...form, solutionPath: e.target.value })}
            placeholder="solutions/sol.cpp" style={{ width: 260 }} />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">Add Stress</button>
        </div>
      </form>

      <div style={{ marginTop: 12, padding: '8px 12px', background: '#fff8e1', border: '1px solid #ffe082', fontSize: 11 }}>
        Note: Stress running UI (watching for first divergence) is available via API. Run via invocations tab with the tested solution.
      </div>
    </div>
  );
}
