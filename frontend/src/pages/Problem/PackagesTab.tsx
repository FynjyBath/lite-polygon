import React, { useState, useEffect, useRef } from 'react';
import { problems, Package, ProblemInfo, VerifyReport } from '../../api/client';

interface Props { problemId: number; info: ProblemInfo; onUpdate: () => void; }

export default function PackagesTab({ problemId, info, onUpdate }: Props) {
  const [packages, setPackages] = useState<Package[]>([]);
  const [type, setType] = useState<'standard' | 'linux' | 'windows'>('standard');
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [building, setBuilding] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [validating, setValidating] = useState(false);
  const [validErrors, setValidErrors] = useState<string[]>([]);
  const [validWarnings, setValidWarnings] = useState<string[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  const [verifyBeforeBuild, setVerifyBeforeBuild] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [verifyReport, setVerifyReport] = useState<VerifyReport | null>(null);
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

  async function handleValidate() {
    setValidating(true); setMsg(''); setError('');
    try {
      const result = await problems.validate(problemId);
      setValidErrors(result.errors);
      setValidWarnings(result.warnings);
      setShowValidation(true);
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally { setValidating(false); }
  }

  async function handleVerify() {
    setVerifying(true); setMsg(''); setError(''); setVerifyReport(null);
    try {
      const report = await problems.verify(problemId);
      setVerifyReport(report);
      setMsg(report.ok ? 'Verification passed' : '');
      if (!report.ok) setError('Verification failed — see report below');
      return report;
    } catch (err: unknown) {
      setError((err as Error).message);
      return null;
    } finally { setVerifying(false); }
  }

  async function handleBuild(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError(''); setShowValidation(false); setVerifyReport(null);

    // Optional full verification before packaging.
    if (verifyBeforeBuild) {
      const report = await handleVerify();
      if (!report || !report.ok) return;
    }

    setValidating(true);
    let errs: string[] = [];
    let warns: string[] = [];
    try {
      const result = await problems.validate(problemId);
      errs = result.errors; warns = result.warnings;
      setValidErrors(errs); setValidWarnings(warns);
    } catch { /* ignore validation errors, proceed */ }
    setValidating(false);
    if (errs.length > 0) {
      setShowValidation(true);
      setError('Build blocked: fix validation errors before building');
      return;
    }
    if (warns.length > 0) setShowValidation(true);
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
          {packages.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>No packages built</td></tr>}
        </tbody>
      </table>

      {info.modified && (
        <div className="alert" style={{ background: 'var(--warn-bg)', border: '1px solid var(--warn-border)', marginBottom: 8 }}>
          You have uncommitted changes. <strong>Commit them</strong> (sidebar) before building a package.
        </div>
      )}

      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Build Package
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-sm" onClick={handleVerify} disabled={verifying || building} style={{ fontWeight: 'normal', fontSize: 11 }}>
            {verifying ? 'Verifying…' : 'Verify'}
          </button>
          <button type="button" className="btn btn-sm" onClick={handleValidate} disabled={validating || building} style={{ fontWeight: 'normal', fontSize: 11 }}>
            {validating ? 'Validating…' : 'Validate Only'}
          </button>
        </span>
      </div>

      {verifyReport && (
        <div style={{ marginBottom: 12, padding: '8px 12px', border: '1px solid var(--border,#ddd)', borderRadius: 4 }}>
          <strong style={{ color: verifyReport.ok ? 'green' : 'red' }}>
            {verifyReport.ok ? '✓ Verification passed' : '✗ Verification failed'}
          </strong>
          <table className="poly-table" style={{ marginTop: 6 }}>
            <tbody>
              {verifyReport.steps.map((s, i) => (
                <tr key={i}>
                  <td style={{ width: 180, fontWeight: 600,
                    color: s.status === 'fail' ? 'red' : s.status === 'warn' ? '#c60' : 'green' }}>
                    {s.status === 'fail' ? '✗' : s.status === 'warn' ? '!' : '✓'} {s.name}
                  </td>
                  <td style={{ fontSize: 11 }}>
                    {(s.details ?? []).map((d, k) => <div key={k}>{d}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showValidation && (
        <div style={{ marginBottom: 12, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 4 }}>
          {validErrors.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <strong style={{ color: 'red' }}>Errors ({validErrors.length}):</strong>
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {validErrors.map((e, i) => <li key={i} style={{ color: 'red', fontSize: 12 }}>{e}</li>)}
              </ul>
            </div>
          )}
          {validWarnings.length > 0 && (
            <div>
              <strong style={{ color: '#c60' }}>Warnings ({validWarnings.length}):</strong>
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {validWarnings.map((w, i) => <li key={i} style={{ color: '#c60', fontSize: 12 }}>{w}</li>)}
              </ul>
            </div>
          )}
          {validErrors.length === 0 && validWarnings.length === 0 && (
            <div style={{ color: 'green', fontSize: 12 }}>All checks passed!</div>
          )}
        </div>
      )}

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
        <div className="form-row">
          <label>Before build:</label>
          <label style={{ minWidth: 0, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={verifyBeforeBuild} onChange={e => setVerifyBeforeBuild(e.target.checked)} />
            Run full verification first
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={building || verifying || info.modified}
            title={info.modified ? 'Commit your changes first' : ''}>
            {building ? 'Building...' : verifying ? 'Verifying…' : 'Build Package'}
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

      <div style={{ marginTop: 16, padding: '8px 12px', background: 'var(--info-bg)', border: '1px solid var(--border)', fontSize: 11 }}>
        <strong>Current problem state:</strong> Rev {info.revision},
        {info.modified ? <span style={{ color: '#c60' }}> Modified</span> : <span style={{ color: 'green' }}> Clean</span>}
      </div>
    </div>
  );
}
