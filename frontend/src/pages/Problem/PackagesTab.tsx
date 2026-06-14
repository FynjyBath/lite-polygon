import React, { useState, useEffect, useRef } from 'react';
import { problems, Package, ProblemInfo } from '../../api/client';

interface Props { problemId: number; info: ProblemInfo; onUpdate: () => void; }

export default function PackagesTab({ problemId, info, onUpdate }: Props) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [type, setType] = useState<'standard' | 'linux' | 'windows'>('standard');
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [building, setBuilding] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  useEffect(() => {
    // Load packages; if any are in-progress, auto-resume the timer and poll
    problems.packages(problemId).then(pkgs => {
      setPackages(pkgs);
      const inProgress = pkgs.find(p => p.state === 'PENDING' || p.state === 'RUNNING');
      if (inProgress) {
        setBuilding(true);
        startTimer();
        pollPackage(inProgress.id);
      }
    }).catch(e => setError(e.message));
    return () => stopTimer();
  }, [problemId]);

  function reload() {
    problems.packages(problemId).then(setPackages).catch(e => setError(e.message));
  }

  function startTimer() {
    setElapsed(0);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function handleBuild(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    setBuilding(true);
    startTimer();
    try {
      const result = await problems.buildPackage(problemId, type, comment);
      reload();
      pollPackage(result.packageId);
    } catch (err: unknown) {
      setError((err as Error).message);
      setBuilding(false);
      stopTimer();
    }
  }

  async function pollPackage(pkgId: number) {
    let attempts = 0;
    while (attempts < 120) {
      await new Promise(r => setTimeout(r, 3000));
      reload();
      const pkgs = await problems.packages(problemId);
      const pkg = pkgs.find(p => p.id === pkgId);
      if (pkg && (pkg.state === 'READY' || pkg.state === 'FAILED')) {
        const took = Math.floor((Date.now() - startTimeRef.current) / 1000);
        stopTimer();
        setMsg(pkg.state === 'READY'
          ? `Package #${pkgId} ready! (${took}s)`
          : `Package #${pkgId} failed`);
        setBuilding(false);
        if (pkg.state === 'READY') onUpdate();
        return;
      }
      attempts++;
    }
    stopTimer();
    setBuilding(false);
  }

  function stateColor(state: string): string {
    if (state === 'READY') return 'green';
    if (state === 'FAILED') return 'red';
    if (state === 'RUNNING') return '#c60';
    return '#888';
  }

  return (
    <div>
      <h2>Packages</h2>
      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <table className="poly-table" style={{ marginBottom: 12 }}>
        <thead>
          <tr><th>#</th><th>Type</th><th>Revision</th><th>State</th><th>Comment</th><th>Created</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {packages.map(p => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.type}</td>
              <td>{p.revision}</td>
              <td style={{ color: stateColor(p.state), fontWeight: 'bold' }}>
                {p.state}
                {building && (p.state === 'RUNNING' || p.state === 'PENDING') && (
                  <span className="spinner" style={{ marginLeft: 4 }} />
                )}
              </td>
              <td>{p.comment}</td>
              <td style={{ fontSize: 11 }}>{p.created_at.slice(0, 16)}</td>
              <td>
                {p.state === 'READY' && (
                  <a
                    href={problems.packageDownloadUrl(problemId, p.id)}
                    className="btn btn-sm"
                    download
                  >
                    Download
                  </a>
                )}
              </td>
            </tr>
          ))}
          {packages.length === 0 && <tr><td colSpan={7} style={{ color: '#888' }}>No packages built</td></tr>}
        </tbody>
      </table>

      <div className="section-header">Build Package</div>
      <form onSubmit={handleBuild}>
        <div className="form-row">
          <label>Type:</label>
          <select value={type} onChange={e => setType(e.target.value as 'standard' | 'linux' | 'windows')}>
            <option value="standard">Standard (sources only)</option>
            <option value="linux">Linux (full with generated tests)</option>
            <option value="windows">Windows (full with .exe)</option>
          </select>
        </div>
        <div className="form-row">
          <label>Comment:</label>
          <input type="text" value={comment} onChange={e => setComment(e.target.value)} style={{ width: 300 }} />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={building}>
            {building ? 'Building...' : 'Build Package'}
          </button>
        </div>
      </form>

      {building && (
        <div style={{ marginTop: 10 }}>
          <div className="flex" style={{ fontSize: 12, color: '#c60', gap: 6 }}>
            <span className="spinner" />
            Building package... ({elapsed}s elapsed)
          </div>
          <div className="progress-bar">
            <div className="progress-bar-fill-indeterminate" />
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, padding: '8px 12px', background: '#f4f8ff', border: '1px solid #cce', fontSize: 11 }}>
        <strong>Current problem state:</strong> Rev {info.revision},
        {info.modified ? <span style={{ color: '#c60' }}> Modified</span> : <span style={{ color: 'green' }}> Clean</span>}
      </div>
    </div>
  );
}
