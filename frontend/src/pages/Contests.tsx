import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { contests, Contest } from '../api/client';
import { useAuth } from '../App';

export default function ContestsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.username === 'admin';
  const [list, setList] = useState<Contest[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { reload(); }, []);
  function reload() {
    contests.list().then(setList).catch(e => setError((e as Error).message)).finally(() => setLoading(false));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true); setError('');
    try {
      const c = await contests.create(name.trim());
      navigate(`/contest/${c.id}`);
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setCreating(false); }
  }

  async function handleDelete(c: Contest) {
    if (!window.confirm(`Delete contest "${c.name}"? Problems themselves are not deleted.`)) return;
    try { await contests.delete(c.id); reload(); }
    catch (err: unknown) { setError((err as Error).message); }
  }

  return (
    <div className="content">
      <div className="problems-list">
        <h2>Contests</h2>
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleCreate} className="flex" style={{ margin: '8px 0 14px' }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="New contest name…"
            style={{ width: 280, border: '1px solid var(--border)', padding: '4px 8px' }} />
          <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? 'Creating…' : 'Create contest'}</button>
        </form>

        {loading ? <div>Loading…</div> : (
          <table className="poly-table">
            <thead>
              <tr><th style={{ width: 50 }}>#</th><th>Name</th><th style={{ width: 110 }}>Owner</th><th style={{ width: 110 }}>Date</th><th style={{ width: 160 }}>Location</th><th style={{ width: 80 }}>Language</th><th style={{ width: 160 }}>Actions</th></tr>
            </thead>
            <tbody>
              {list.map(c => (
                <tr key={c.id}>
                  <td>{c.id}</td>
                  <td><a className="poly-link" style={{ cursor: 'pointer' }} onClick={() => navigate(`/contest/${c.id}`)}>{c.name || '(unnamed)'}</a></td>
                  <td style={{ color: 'var(--muted)', fontSize: 12 }}>{c.owner_username}</td>
                  <td>{c.date}</td>
                  <td>{c.location}</td>
                  <td>{c.language}</td>
                  <td style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm" onClick={() => navigate(`/contest/${c.id}`)}>Open</button>
                    {(isAdmin || c.owner_username === user?.username) && (
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(c)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={7} style={{ color: 'var(--muted)', textAlign: 'center', padding: 12 }}>No contests yet</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
