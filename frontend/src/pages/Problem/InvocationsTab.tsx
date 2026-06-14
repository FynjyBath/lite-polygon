import React, { useState, useEffect, useRef } from 'react';
import { problems, Invocation, InvocationRun, Solution, TestPreview, TestGroup } from '../../api/client';

interface Props { problemId: number; testsCount: number; solutionsCount: number; timeLimit?: number; }

interface ActiveView {
  inv: Invocation;
  runs: InvocationRun[];
  tests: TestPreview[];
  groups: TestGroup[];
}

interface CellDetail {
  solId: number;
  testIdx: number;
  run: InvocationRun;
  sol: Solution | undefined;
}

function fmtTime(ms: number): string { return `${ms}ms`; }
function fmtMem(bytes: number): string {
  const mb = Math.round(bytes / 1024 / 1024);
  return `${mb}MB`;
}

function verdictBg(verdict: string, isOk: boolean, isSlowest: boolean, isNearTL: boolean): string {
  if (!isOk) {
    if (verdict === 'TL' || verdict === 'TLE' || verdict === 'TIME_LIMIT_EXCEEDED') return '#ffe4b5';
    if (verdict === 'ML' || verdict === 'MLE' || verdict === 'MEMORY_LIMIT_EXCEEDED') return '#f0d0ff';
    if (verdict === 'SKIPPED') return '#f0f0f0';
    return '#ffe0e0';
  }
  if (isSlowest) return '#c8e6ff';
  if (isNearTL) return '#fff0c8';
  return '#e8ffec';
}

function verdictLabel(verdict: string): string {
  if (verdict === 'TIME_LIMIT_EXCEEDED' || verdict === 'TLE') return 'TL';
  if (verdict === 'MEMORY_LIMIT_EXCEEDED' || verdict === 'MLE') return 'ML';
  if (verdict === 'WRONG_ANSWER' || verdict === 'WA') return 'WA';
  if (verdict === 'RUNTIME_ERROR' || verdict === 'RE') return 'RE';
  if (verdict === 'PRESENTATION_ERROR' || verdict === 'PE') return 'PE';
  if (verdict === 'COMPILATION_ERROR' || verdict === 'CE') return 'CE';
  if (verdict === 'SKIPPED') return 'SK';
  return verdict.slice(0, 2);
}

export default function InvocationsTab({ problemId, testsCount, solutionsCount, timeLimit }: Props) {
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [selectedSols, setSelectedSols] = useState<number[]>([]);
  const [active, setActive] = useState<ActiveView | null>(null);
  const [cellDetail, setCellDetail] = useState<CellDetail | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [polling, setPolling] = useState(false);
  const [pollingRuns, setPollingRuns] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    problems.solutions(problemId).then(setSolutions);
    problems.invocations(problemId).then(invs => {
      setInvocations(invs);
      const running = invs.find(i => i.state === 'RUNNING');
      if (running) pollInvocation(running.id);
    }).catch(e => setError(e.message));
    return () => { mountedRef.current = false; };
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
    } catch (err: unknown) { setError((err as Error).message); }
  }

  async function pollInvocation(invId: number) {
    if (!mountedRef.current) return;
    setPolling(true); setPollingRuns(0);
    let attempts = 0;
    while (attempts < 180) {
      await new Promise(r => setTimeout(r, 2000));
      if (!mountedRef.current) break;
      try {
        const result = await problems.invocationResults(problemId, invId);
        if (!mountedRef.current) break;
        setPollingRuns(result.runs.length);
        if (active?.inv.id === invId) {
          const [ts, gs] = await Promise.all([
            problems.previewTests(problemId),
            problems.viewTestGroup(problemId),
          ]);
          if (!mountedRef.current) break;
          setActive(prev => prev ? { ...prev, runs: result.runs, tests: ts, groups: gs, inv: { ...prev.inv, state: result.state } } : null);
        }
        if (result.state === 'DONE' || result.state === 'FAILED') {
          reload(); setPolling(false); setPollingRuns(0); setMsg('');
          return;
        }
      } catch { break; }
      attempts++;
    }
    if (mountedRef.current) { setPolling(false); setPollingRuns(0); }
  }

  async function handleView(inv: Invocation) {
    try {
      const [result, ts, gs] = await Promise.all([
        problems.invocationResults(problemId, inv.id),
        problems.previewTests(problemId),
        problems.viewTestGroup(problemId),
      ]);
      setActive({ inv: { ...inv, state: result.state }, runs: result.runs, tests: ts, groups: gs });
      setCellDetail(null);
    } catch (err: unknown) { setError((err as Error).message); }
  }

  async function handleRejudge() {
    if (!active) return;
    const solIds = [...new Set(active.runs.map(r => r.solution_id))];
    setActive(null); setCellDetail(null);
    setMsg(''); setError('');
    try {
      const result = await problems.runInvocation(problemId, solIds);
      setMsg(`Rejudge invocation ${result.invocationId} started`);
      reload();
      pollInvocation(result.invocationId);
    } catch (err: unknown) { setError((err as Error).message); }
  }

  function buildMatrix() {
    if (!active) return null;
    const { runs, tests, groups } = active;
    const solIds = [...new Set(runs.map(r => r.solution_id))];
    const testIdxs = [...new Set(runs.map(r => r.test_idx))].sort((a, b) => a - b);
    const map = new Map<string, InvocationRun>();
    for (const r of runs) map.set(`${r.solution_id}_${r.test_idx}`, r);

    const groupNames = [...new Set(tests.map(t => t.group_name).filter(Boolean))];
    const hasGroups = groupNames.length > 0;

    // Per-solution stats
    const solStats = new Map<number, {
      totalPassed: number;
      maxTimeMs: number;
      maxMemBytes: number;
      byGroup: Map<string, { passed: number; total: number; earnedPts: number; maxPts: number }>;
    }>();
    for (const solId of solIds) {
      const byGroup = new Map<string, { passed: number; total: number; earnedPts: number; maxPts: number }>();
      let totalPassed = 0, maxTimeMs = 0, maxMemBytes = 0;
      for (const ti of testIdxs) {
        const run = map.get(`${solId}_${ti}`);
        const test = tests.find(t => t.idx === ti);
        const gn = test?.group_name ?? '';
        if (!byGroup.has(gn)) {
          const gDef = groups.find(g => g.name === gn);
          byGroup.set(gn, { passed: 0, total: 0, earnedPts: 0, maxPts: gDef?.points ?? 0 });
        }
        const gs = byGroup.get(gn)!;
        gs.total++;
        if (run) {
          const isOk = run.verdict === 'OK';
          if (isOk) { gs.passed++; totalPassed++; gs.earnedPts += run.points ?? 0; }
          if (run.time_ms > maxTimeMs) maxTimeMs = run.time_ms;
          if (run.memory_bytes > maxMemBytes) maxMemBytes = run.memory_bytes;
        }
      }
      solStats.set(solId, { totalPassed, maxTimeMs, maxMemBytes, byGroup });
    }

    // Per-column slowest (among OK runs)
    const colSlowest = new Map<number, number>();
    for (const solId of solIds) {
      let max = 0;
      for (const ti of testIdxs) {
        const run = map.get(`${solId}_${ti}`);
        if (run?.verdict === 'OK' && run.time_ms > max) max = run.time_ms;
      }
      colSlowest.set(solId, max);
    }

    return { solIds, testIdxs, map, groupNames, hasGroups, solStats, colSlowest };
  }

  const matrix = active ? buildMatrix() : null;
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
            {pollingRuns > 0 && <span>{pollingRuns}{totalRuns > 0 ? `/${totalRuns}` : ''} tests done</span>}
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
            <tr key={inv.id} style={active?.inv.id === inv.id ? { background: '#f0f4ff' } : undefined}>
              <td>{inv.id}</td>
              <td style={{ fontSize: 11 }}>{inv.created_at.slice(0, 16)}</td>
              <td style={{ color: inv.state === 'DONE' ? 'green' : inv.state === 'FAILED' ? 'red' : '#c60' }}>
                {inv.state}
                {polling && inv.state === 'RUNNING' && <span className="spinner" style={{ marginLeft: 4 }} />}
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
            <div style={{ display: 'flex', gap: 8 }}>
              {active.inv.state === 'DONE' && (
                <button className="btn btn-sm" onClick={handleRejudge}>Rejudge</button>
              )}
              <button className="btn btn-sm" onClick={() => { setActive(null); setCellDetail(null); }}>Close</button>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="poly-table" style={{ fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f0f0f0' }}>
                  <th style={{ minWidth: 36, textAlign: 'center' }}>#</th>
                  {matrix.solIds.map(solId => {
                    const sol = solutions.find(s => s.id === solId);
                    const shortName = sol?.source_path.split('/').pop() ?? `#${solId}`;
                    return (
                      <th key={solId} style={{ minWidth: 90, fontFamily: 'monospace', fontSize: 10, fontWeight: 'normal', padding: '3px 6px' }}>
                        <div style={{ fontWeight: 'bold' }}>{shortName}</div>
                        {sol?.tag && <div style={{ color: '#888', fontSize: 9 }}>({sol.tag})</div>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {/* Test rows */}
                {matrix.testIdxs.map(ti => {
                  const test = active.tests.find(t => t.idx === ti);
                  return (
                    <tr key={ti}>
                      <td style={{ textAlign: 'center', color: '#666', padding: '2px 4px' }}>
                        {ti}{test?.sample ? <span title="Sample" style={{ color: '#090', marginLeft: 2 }}>s</span> : null}
                        {test?.group_name ? <span style={{ color: '#888', marginLeft: 2, fontSize: 9 }}>[{test.group_name}]</span> : null}
                      </td>
                      {matrix.solIds.map(solId => {
                        const run = matrix.map.get(`${solId}_${ti}`);
                        if (!run) return <td key={solId} style={{ color: '#ccc', textAlign: 'center', padding: '2px 4px' }}>—</td>;
                        const isOk = run.verdict === 'OK';
                        const isSlowest = isOk && run.time_ms === matrix.colSlowest.get(solId) && run.time_ms > 0;
                        const isNearTL = isOk && timeLimit && run.time_ms > timeLimit / 2;
                        const bg = verdictBg(run.verdict, isOk, isSlowest, !!isNearTL);
                        const label = verdictLabel(run.verdict);
                        return (
                          <td
                            key={solId}
                            style={{ background: bg, cursor: 'pointer', padding: '2px 4px', whiteSpace: 'nowrap', textAlign: 'center', borderLeft: '1px solid #e8e8e8' }}
                            onClick={() => setCellDetail({ solId, testIdx: ti, run, sol: solutions.find(s => s.id === solId) })}
                            title={`${run.verdict} | ${run.time_ms}ms | ${Math.round(run.memory_bytes / 1024 / 1024)}MB\n${run.stderr_preview || ''}`}
                          >
                            <span style={{ fontWeight: 'bold', color: isOk ? '#060' : '#900' }}>{label}</span>
                            {' '}
                            <span style={{ color: '#555', fontSize: 10 }}>{run.time_ms}/{Math.round(run.memory_bytes / 1024 / 1024)}</span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                {/* Group stat rows */}
                {matrix.hasGroups && matrix.groupNames.map(gn => {
                  const gDef = active.groups.find(g => g.name === gn);
                  return (
                    <React.Fragment key={`g_${gn}`}>
                      <tr style={{ background: '#f5f5f5', fontStyle: 'italic' }}>
                        <td style={{ color: '#555', fontSize: 10, padding: '2px 4px', whiteSpace: 'nowrap' }}>
                          Group {gn} passed
                        </td>
                        {matrix.solIds.map(solId => {
                          const gs = matrix.solStats.get(solId)?.byGroup.get(gn);
                          return (
                            <td key={solId} style={{ textAlign: 'center', padding: '2px 4px', fontWeight: 'bold' }}>
                              {gs ? `${gs.passed}/${gs.total}` : '—'}
                            </td>
                          );
                        })}
                      </tr>
                      {gDef && gDef.points > 0 && (
                        <tr style={{ background: '#f5f5f5', fontStyle: 'italic' }}>
                          <td style={{ color: '#555', fontSize: 10, padding: '2px 4px', whiteSpace: 'nowrap' }}>
                            Group {gn} points
                          </td>
                          {matrix.solIds.map(solId => {
                            const gs = matrix.solStats.get(solId)?.byGroup.get(gn);
                            const earned = gs?.earnedPts ?? 0;
                            const max = gDef.points;
                            return (
                              <td key={solId} style={{ textAlign: 'center', padding: '2px 4px' }}>
                                {earned.toFixed(2)}/{max.toFixed(2)}
                              </td>
                            );
                          })}
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {/* Σ passed tests */}
                <tr style={{ background: '#eef4ff', fontWeight: 'bold' }}>
                  <td style={{ padding: '2px 4px', color: '#333', fontSize: 10 }}>Σ passed</td>
                  {matrix.solIds.map(solId => {
                    const st = matrix.solStats.get(solId);
                    return (
                      <td key={solId} style={{ textAlign: 'center', padding: '2px 4px' }}>
                        {st?.totalPassed ?? 0}/{matrix.testIdxs.length}
                      </td>
                    );
                  })}
                </tr>

                {/* max row */}
                <tr style={{ background: '#eef4ff' }}>
                  <td style={{ padding: '2px 4px', color: '#333', fontSize: 10 }}>max.</td>
                  {matrix.solIds.map(solId => {
                    const st = matrix.solStats.get(solId);
                    if (!st) return <td key={solId} style={{ textAlign: 'center', padding: '2px 4px' }}>—</td>;
                    return (
                      <td key={solId} style={{ textAlign: 'center', padding: '2px 4px', fontSize: 10 }}>
                        {fmtTime(st.maxTimeMs)} / {fmtMem(st.maxMemBytes)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Cell detail panel */}
          {cellDetail && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#f9f9f9', border: '1px solid #ddd', fontSize: 12 }}>
              <div className="flex-between" style={{ marginBottom: 6 }}>
                <strong>
                  Test {cellDetail.testIdx} — {cellDetail.sol?.source_path ?? `#${cellDetail.solId}`}
                </strong>
                <button className="btn btn-sm" onClick={() => setCellDetail(null)}>✕</button>
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>
                  Verdict: <strong style={{ color: cellDetail.run.verdict === 'OK' ? 'green' : 'red' }}>
                    {cellDetail.run.verdict}
                  </strong>
                </span>
                <span>Time: <strong>{cellDetail.run.time_ms}ms</strong></span>
                <span>Memory: <strong>{fmtMem(cellDetail.run.memory_bytes)}</strong></span>
                {cellDetail.run.exit_code !== 0 && <span>Exit code: <strong>{cellDetail.run.exit_code}</strong></span>}
              </div>
              {cellDetail.run.stderr_preview && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ color: '#666', marginBottom: 2 }}>Checker / stderr output:</div>
                  <div className="code-view" style={{ maxHeight: 120, fontSize: 10 }}>{cellDetail.run.stderr_preview}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
