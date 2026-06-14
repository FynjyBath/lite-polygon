import React, { useState, useEffect } from 'react';
import { problems, Invocation, InvocationRun, Solution } from '../../api/client';

interface Props { problemId: number; testsCount: number; solutionsCount: number; }

export default function InvocationsTab({ problemId, testsCount, solutionsCount }: Props) {
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [selectedSols, setSelectedSols] = useState<number[]>([]);
  const [active, setActive] = useState<{ inv: Invocation; runs: InvocationRun[] } | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [polling, setPolling] = useState(false);
  const [pollingRuns, setPollingRuns] = useState(0);

  useEffect(() => {
    problems.solutions(problemId).then(setSolutions);
    reload();
  }, [problemId]);

  function reload() {
    problems.invocations(problemId).then(setInvocations).catch(e => setError(e.message));
  }

  async function handleRun() {
    setMsg(''); setError('');
    try {
      const result = await problems.runInvocation(problemId, selectedSols.length > 0 ? selectedSols : undefined);
      setMsg(`Invocation ${result.invocationId} started`);
      setActive(null);
      reload();
      pollInvocation(result.invocationId);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function pollInvocation(invId: number) {
    setPolling(true);
    setPollingRuns(0);
    let attempts = 0;
    while (attempts < 120) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        const result = await problems.invocationResults(problemId, invId);
        setPollingRuns(result.runs.length);
        // Update matrix live as runs come in
        const inv = invocations.find(i => i.id === invId)
          ?? { id: invId, state: result.state, testset_name: 'tests', created_at: '' };
        setActive({ inv: { ...inv, state: result.state }, runs: result.runs });
        if (result.state === 'DONE' || result.state === 'FAILED') {
          reload();
          setPolling(false);
          setPollingRuns(0);
          setMsg('');
          return;
        }
      } catch { break; }
      attempts++;
    }
    setPolling(false);
    setPollingRuns(0);
  }

  async function handleView(inv: Invocation) {
    try {
      const result = await problems.invocationResults(problemId, inv.id);
      setActive({ inv: { ...inv, state: result.state }, runs: result.runs });
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  function buildMatrix() {
    if (!active) return null;
    const solIds = [...new Set(active.runs.map(r => r.solution_id))];
    const testIdxs = [...new Set(active.runs.map(r => r.test_idx))].sort((a, b) => a - b);
    const map = new Map<string, InvocationRun>();
    for (const r of active.runs) map.set(`${r.solution_id}_${r.test_idx}`, r);
    return { solIds, testIdxs, map };
  }

  const matrix = buildMatrix();

  const totalRuns = testsCount * (selectedSols.length > 0 ? selectedSols.length : solutionsCount);
  const progressPct = totalRuns > 0 ? Math.min(100, (pollingRuns / totalRuns) * 100) : 0;

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <h2>Invocations</h2>
        <button className="btn btn-primary" onClick={handleRun} disabled={polling}>
          Run Invocation
        </button>
      </div>

      {polling && (
        <div style={{ marginBottom: 8 }}>
          <div className="flex" style={{ color: '#c60', fontSize: 12, gap: 6 }}>
            <span className="spinner" />
            Running invocation...
            {pollingRuns > 0 && (
              <span>
                {pollingRuns}{totalRuns > 0 ? `/${totalRuns}` : ''} test{pollingRuns !== 1 ? 's' : ''} done
              </span>
            )}
          </div>
          <div className="progress-bar">
            {totalRuns > 0
              ? <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
              : <div className="progress-bar-fill-indeterminate" />}
          </div>
        </div>
      )}

      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 12 }}>Select solutions (blank = all):</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {solutions.map(s => (
            <label key={s.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={selectedSols.includes(s.id)}
                onChange={e => {
                  if (e.target.checked) setSelectedSols([...selectedSols, s.id]);
                  else setSelectedSols(selectedSols.filter(x => x !== s.id));
                }}
              />
              {s.source_path} <span style={{ color: '#888' }}>({s.tag})</span>
            </label>
          ))}
        </div>
      </div>

      <table className="poly-table" style={{ marginBottom: 12 }}>
        <thead>
          <tr><th>#</th><th>Created</th><th>State</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {invocations.map(inv => (
            <tr key={inv.id}>
              <td>{inv.id}</td>
              <td style={{ fontSize: 11 }}>{inv.created_at.slice(0, 16)}</td>
              <td style={{ color: inv.state === 'DONE' ? 'green' : inv.state === 'FAILED' ? 'red' : '#c60' }}>
                {inv.state}
              </td>
              <td><button className="btn btn-sm" onClick={() => handleView(inv)}>View</button></td>
            </tr>
          ))}
          {invocations.length === 0 && <tr><td colSpan={4} style={{ color: '#888' }}>No invocations</td></tr>}
        </tbody>
      </table>

      {active && matrix && (
        <div>
          <div className="flex-between" style={{ marginBottom: 4 }}>
            <strong>
              Invocation #{active.inv.id} —{' '}
              <span style={{ color: active.inv.state === 'DONE' ? 'green' : active.inv.state === 'FAILED' ? 'red' : '#c60' }}>
                {active.inv.state}
              </span>
              {polling && <span className="spinner" style={{ marginLeft: 8 }} />}
            </strong>
            <button className="btn btn-sm" onClick={() => setActive(null)}>Close</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="poly-table" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th>Solution</th>
                  {matrix.testIdxs.map(i => <th key={i}>{i}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.solIds.map(solId => {
                  const sol = solutions.find(s => s.id === solId);
                  return (
                    <tr key={solId}>
                      <td style={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 10 }}>
                        {sol?.source_path ?? `#${solId}`}
                        <span style={{ marginLeft: 4, color: '#888' }}>({sol?.tag})</span>
                      </td>
                      {matrix.testIdxs.map(ti => {
                        const run = matrix.map.get(`${solId}_${ti}`);
                        if (!run) return <td key={ti} style={{ color: '#ccc' }}>—</td>;
                        const v = run.verdict;
                        return (
                          <td key={ti} className={`verdict-${v}`} title={`${run.time_ms}ms`}>
                            {v.slice(0, 2)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
