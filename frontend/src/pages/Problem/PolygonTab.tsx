import React, { useState, useEffect } from 'react';
import { polygon, ProblemInfo } from '../../api/client';

interface Props { problemId: number; info: ProblemInfo; onUpdate: () => void; }

export default function PolygonTab({ problemId, info, onUpdate }: Props) {
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [savedSecret, setSavedSecret] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);

  // Shared key fields
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [remember, setRemember] = useState(false);

  // Push state
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ done: string[]; errors: string[] } | null>(null);

  // Create on Polygon state
  const [createName, setCreateName] = useState(info.shortName);
  const [pushAfter, setPushAfter] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ polygonProblemId: number; polygonName: string; push?: { done: string[]; errors: string[] } | null } | null>(null);

  // Link state
  const [linkId, setLinkId] = useState('');
  const [linking, setLinking] = useState(false);

  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    polygon.savedKey().then(r => {
      setHasKey(r.hasKey);
      setSavedKey(r.apiKey);
      setSavedSecret(r.apiSecret);
      if (r.apiKey) setApiKey(r.apiKey);
      if (r.apiSecret) setApiSecret(r.apiSecret);
    }).catch(() => {});
  }, []);

  const pgId = info.polygonProblemId;

  function clearResult() { setMsg(''); setError(''); setPushResult(null); setCreateResult(null); }

  function effectiveKey() { return apiKey.trim() || savedKey || ''; }
  function effectiveSecret() { return apiSecret.trim() || savedSecret || ''; }

  async function handleSaveKey() {
    if (!apiKey.trim() || !apiSecret.trim()) { setError('Enter both key and secret to save'); return; }
    try {
      await polygon.saveKey(apiKey.trim(), apiSecret.trim());
      setHasKey(true); setSavedKey(apiKey.trim()); setSavedSecret(apiSecret.trim());
      setMsg('API key saved');
    } catch (e: unknown) { setError((e as Error).message); }
  }

  async function handleClearKey() {
    try {
      await polygon.clearKey();
      setHasKey(false); setSavedKey(null); setSavedSecret(null);
      setApiKey(''); setApiSecret('');
      setMsg('Saved key cleared');
    } catch (e: unknown) { setError((e as Error).message); }
  }

  async function handlePush() {
    clearResult(); setPushing(true);
    try {
      const result = await polygon.pushProblem(problemId, effectiveKey(), effectiveSecret(), remember);
      if (remember && apiKey.trim() && apiSecret.trim()) { setHasKey(true); setSavedKey(apiKey.trim()); }
      setPushResult({ done: result.done, errors: result.errors });
      if (result.errors.length === 0) setMsg(`Pushed to Polygon problem #${result.polygonProblemId}: ${result.done.length} item(s) synced`);
      else setMsg(`Pushed with ${result.errors.length} error(s)`);
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setPushing(false); }
  }

  async function handleCreate() {
    clearResult(); setCreating(true);
    try {
      const result = await polygon.createProblem(problemId, createName, effectiveKey(), effectiveSecret(), remember, pushAfter);
      if (remember && apiKey.trim() && apiSecret.trim()) { setHasKey(true); setSavedKey(apiKey.trim()); }
      setCreateResult({ polygonProblemId: result.polygonProblemId, polygonName: result.polygonName, push: result.push });
      setMsg(`Created Polygon problem #${result.polygonProblemId} (${result.polygonName})`);
      onUpdate();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setCreating(false); }
  }

  async function handleLink() {
    const pgid = parseInt(linkId);
    if (!pgid) { setError('Enter a valid Polygon problem ID'); return; }
    clearResult(); setLinking(true);
    try {
      await polygon.linkProblem(problemId, pgid);
      setMsg(`Linked to Polygon problem #${pgid}`);
      onUpdate();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setLinking(false); }
  }

  return (
    <div>
      <h2>Polygon API Sync</h2>
      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>
        Sync this problem with Codeforces Polygon. Get your API key at{' '}
        <a href="https://polygon.codeforces.com/settings" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>polygon.codeforces.com/settings</a>.
      </p>

      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {/* ── API Key section ─────────────────────────────────────── */}
      <div className="section-header">API Credentials</div>
      {hasKey && (
        <div style={{ marginBottom: 8, padding: '6px 10px', background: 'var(--ok-bg)', border: '1px solid #c0d8c0', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Saved credentials loaded into fields below</span>
          <button className="btn btn-sm btn-danger" onClick={handleClearKey} style={{ fontSize: 11 }}>Clear</button>
        </div>
      )}
      <div className="form-row">
        <label>API Key:</label>
        <input
          type="text"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="Enter API key"
          style={{ width: 320 }}
        />
      </div>
      <div className="form-row">
        <label>API Secret:</label>
        <input
          type="password"
          value={apiSecret}
          onChange={e => setApiSecret(e.target.value)}
          placeholder="Enter API secret"
          style={{ width: 320 }}
        />
      </div>
      <div className="form-row">
        <label />
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          Remember API key on next use
        </label>
        {(apiKey.trim() && apiSecret.trim()) && (
          <button className="btn btn-sm" onClick={handleSaveKey} style={{ marginLeft: 8 }}>Save Key Now</button>
        )}
      </div>

      {/* ── Current Polygon link ─────────────────────────────────── */}
      <div className="section-header" style={{ marginTop: 16 }}>Polygon Link</div>
      {pgId ? (
        <div style={{ padding: '8px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 12, fontSize: 12 }}>
          Linked to Polygon problem <strong>#{pgId}</strong>
          {' '}<a href={`https://polygon.codeforces.com/problems/${pgId}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Open on Polygon</a>
        </div>
      ) : (
        <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 8 }}>Not linked to any Polygon problem.</div>
      )}

      {/* Link manually */}
      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--accent)' }}>
          {pgId ? 'Change Polygon link' : 'Link to existing Polygon problem'}
        </summary>
        <div style={{ paddingTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number"
            value={linkId}
            onChange={e => setLinkId(e.target.value)}
            placeholder="Polygon problem ID"
            style={{ width: 180 }}
          />
          <button className="btn btn-primary btn-sm" onClick={handleLink} disabled={linking}>
            {linking ? 'Linking…' : 'Link'}
          </button>
        </div>
      </details>

      {/* ── Push to Polygon ──────────────────────────────────────── */}
      {pgId && (
        <div style={{ marginBottom: 16 }}>
          <div className="section-header">Push Local Changes to Polygon</div>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
            Uploads problem info, statements, solutions, checker, validator, and tests to Polygon problem #{pgId}.
          </p>
          <button
            className="btn btn-primary"
            onClick={handlePush}
            disabled={pushing || (!hasKey && (!apiKey.trim() || !apiSecret.trim()))}
          >
            {pushing ? <><span className="spinner" style={{ marginRight: 6 }} />Pushing…</> : `Push to Polygon #${pgId}`}
          </button>
          {pushResult && (
            <div style={{ marginTop: 10 }}>
              {pushResult.done.length > 0 && (
                <div style={{ color: 'green', fontSize: 12, marginBottom: 4 }}>
                  <strong>Done ({pushResult.done.length}):</strong>{' '}
                  {pushResult.done.join(' • ')}
                </div>
              )}
              {pushResult.errors.length > 0 && (
                <div style={{ fontSize: 12 }}>
                  <strong style={{ color: 'red' }}>Errors ({pushResult.errors.length}):</strong>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {pushResult.errors.map((e, i) => <li key={i} style={{ color: 'red' }}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Create new on Polygon ────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <div className="section-header">Create New Problem on Polygon</div>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
          Creates a new problem on Polygon and links it to this local problem. Optionally pushes all data immediately.
        </p>
        <div className="form-row">
          <label>Short name:</label>
          <input
            type="text"
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            placeholder="my-problem"
            style={{ width: 200 }}
          />
        </div>
        <div className="form-row">
          <label />
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={pushAfter} onChange={e => setPushAfter(e.target.checked)} />
            Push all local data after creating
          </label>
        </div>
        <div className="form-actions">
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={creating || !createName.trim() || (!hasKey && (!apiKey.trim() || !apiSecret.trim()))}
          >
            {creating ? <><span className="spinner" style={{ marginRight: 6 }} />Creating…</> : 'Create on Polygon'}
          </button>
        </div>
        {createResult && (
          <div style={{ marginTop: 10, fontSize: 12 }}>
            <div style={{ color: 'green', marginBottom: 4 }}>
              Created Polygon problem <strong>#{createResult.polygonProblemId}</strong> ({createResult.polygonName})
            </div>
            {createResult.push && createResult.push.done.length > 0 && (
              <div style={{ color: 'green' }}>Pushed: {createResult.push.done.join(' • ')}</div>
            )}
            {createResult.push && createResult.push.errors.length > 0 && (
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {createResult.push.errors.map((e, i) => <li key={i} style={{ color: 'red' }}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
