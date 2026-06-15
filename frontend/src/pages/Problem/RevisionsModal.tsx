import React, { useState, useEffect } from 'react';
import { problems } from '../../api/client';

interface Rev { id: number; revision: number; comment: string; created_at: string; }

interface Props {
  problemId: number;
  currentRevision: number;
  onClose: () => void;
  onRestored: () => void;
}

/** Lists committed revisions and lets the user roll the working copy back. */
export default function RevisionsModal({ problemId, currentRevision, onClose, onRestored }: Props) {
  const [revs, setRevs] = useState<Rev[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    problems.revisions(problemId)
      .then(setRevs).catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [problemId]);

  async function restore(rev: number) {
    if (!window.confirm(`Restore the working copy to revision ${rev}? This replaces the current uncommitted state; commit afterwards to keep it as a new revision.`)) return;
    setBusy(rev); setError(''); setMsg('');
    try {
      await problems.restoreRevision(problemId, rev);
      setMsg(`Restored to revision ${rev}. Review and commit to save it as a new revision.`);
      onRestored();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--surface)', borderRadius: 6, width: 560, maxWidth: '94vw', maxHeight: '86vh', display: 'flex', flexDirection: 'column', padding: 18 }}>
        <div className="flex-between" style={{ marginBottom: 10 }}>
          <strong>Revision history</strong>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>

        {msg && <div className="alert alert-success" style={{ marginBottom: 8 }}>{msg}</div>}
        {error && <div className="alert alert-error" style={{ marginBottom: 8 }}>{error}</div>}

        <div style={{ overflowY: 'auto' }}>
          {loading ? <div style={{ color: 'var(--muted)' }}>Loading…</div> : revs.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>No revisions yet — press “Commit” to create the first one.</div>
          ) : (
            <table className="poly-table" style={{ fontSize: 12 }}>
              <thead>
                <tr><th style={{ width: 50 }}>Rev</th><th>Comment</th><th style={{ width: 130 }}>Committed</th><th style={{ width: 80 }}>Action</th></tr>
              </thead>
              <tbody>
                {revs.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 'bold' }}>
                      {r.revision}{r.revision === currentRevision && <span style={{ color: 'var(--muted)', fontWeight: 'normal' }}> (current)</span>}
                    </td>
                    <td>{r.comment || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{r.created_at.slice(0, 16).replace('T', ' ')}</td>
                    <td>
                      <button className="btn btn-sm" disabled={busy !== null} onClick={() => restore(r.revision)}>
                        {busy === r.revision ? '…' : 'Restore'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
