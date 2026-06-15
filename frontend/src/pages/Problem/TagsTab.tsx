import React, { useState, useEffect } from 'react';
import { problems, ProblemInfo } from '../../api/client';

interface Props { problemId: number; info: ProblemInfo; onUpdate: () => void; }

export default function TagsTab({ problemId, info, onUpdate }: Props) {
  const [tags, setTags] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    problems.tags(problemId).then(t => {
      setTags(t);
      setInput(t.join(', '));
    });
  }, [problemId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    const parsed = input.split(',').map(t => t.trim()).filter(Boolean);
    try {
      await problems.saveTags(problemId, parsed);
      setTags(parsed);
      setMsg('Tags saved');
      onUpdate();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  function removeTag(tag: string) {
    const updated = tags.filter(t => t !== tag);
    setTags(updated);
    setInput(updated.join(', '));
  }

  return (
    <div>
      <h2>Tags</h2>
      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {tags.map(t => (
          <span key={t} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 8px', fontSize: 12 }}>
            {t}
            <button onClick={() => removeTag(t)} style={{ marginLeft: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>×</button>
          </span>
        ))}
        {tags.length === 0 && <span style={{ color: 'var(--muted)', fontSize: 12 }}>No tags</span>}
      </div>

      <form onSubmit={handleSave}>
        <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <label style={{ marginBottom: 4 }}>Tags (comma-separated):</label>
          <input type="text" value={input} onChange={e => setInput(e.target.value)}
            style={{ width: 400 }} placeholder="avx, data structures, fenwick tree" />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">Save Tags</button>
        </div>
      </form>
    </div>
  );
}
