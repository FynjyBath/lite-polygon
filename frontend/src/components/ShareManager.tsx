import React, { useState, useEffect } from 'react';

interface User { id: number; username: string; }

interface Props {
  load: () => Promise<User[]>;
  add: (username: string) => Promise<User[]>;
  remove: (username: string) => Promise<User[]>;
  note?: string;
}

/** List of users something is shared with, with add-by-username and remove. */
export default function ShareManager({ load, add, remove, note }: Props) {
  const [shares, setShares] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { load().then(setShares).catch(e => setError((e as Error).message)); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const u = username.trim();
    if (!u) return;
    setBusy(true); setError('');
    try { setShares(await add(u)); setUsername(''); }
    catch (err: unknown) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function handleRemove(u: string) {
    setBusy(true); setError('');
    try { setShares(await remove(u)); }
    catch (err: unknown) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      {note && <div style={{ fontSize: 11, color: 'var(--muted,#666)', marginBottom: 6 }}>{note}</div>}
      {error && <div className="alert alert-error" style={{ marginBottom: 6 }}>{error}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {shares.map(s => (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--surface-2,#eef)', border: '1px solid var(--border,#ccd)', borderRadius: 12, padding: '2px 6px 2px 10px', fontSize: 12 }}>
            {s.username}
            <button className="btn btn-sm btn-danger" style={{ padding: '0 5px', lineHeight: 1.4 }} onClick={() => handleRemove(s.username)} disabled={busy} title="Revoke access">×</button>
          </span>
        ))}
        {shares.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted,#888)' }}>Not shared with anyone yet</span>}
      </div>
      <form onSubmit={handleAdd} className="flex" style={{ gap: 6 }}>
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="username to share with…"
          style={{ width: 220, border: '1px solid var(--border)', padding: '3px 8px' }} />
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !username.trim()}>Share</button>
      </form>
    </div>
  );
}
