import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { contests, problems, Contest, ContestProblem, ProblemSummary } from '../api/client';
import ShareManager from '../components/ShareManager';

const LANGS = ['russian', 'english', 'ukrainian'];

export default function ContestPage() {
  const { id } = useParams<{ id: string }>();
  const contestId = parseInt(id ?? '');

  const [contest, setContest] = useState<Contest | null>(null);
  const [probs, setProbs] = useState<ContestProblem[]>([]);
  const [allProblems, setAllProblems] = useState<ProblemSummary[]>([]);
  const [form, setForm] = useState({ name: '', location: '', date: '', language: 'russian' });
  const [addId, setAddId] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // PDF compile state
  const [kind, setKind] = useState<'statements' | 'tutorials'>('statements');
  const [pdfLang, setPdfLang] = useState('russian');
  const [compiling, setCompiling] = useState(false);
  const [compileLog, setCompileLog] = useState('');
  const [showLog, setShowLog] = useState(false);
  const [pdfVersion, setPdfVersion] = useState(0);

  useEffect(() => { reload(); problems.list().then(setAllProblems).catch(() => {}); }, [contestId]);

  function reload() {
    contests.info(contestId).then(c => {
      setContest(c);
      setProbs(c.problems);
      setForm({ name: c.name, location: c.location, date: c.date, language: c.language });
      setPdfLang(c.language || 'russian');
    }).catch(e => setError((e as Error).message));
  }

  async function saveFields() {
    setMsg(''); setError('');
    try { await contests.update(contestId, form); setMsg('Saved'); reload(); }
    catch (e: unknown) { setError((e as Error).message); }
  }

  async function addProblem() {
    const pid = parseInt(addId);
    if (!pid) return;
    setError('');
    try { setProbs(await contests.addProblem(contestId, pid)); setAddId(''); setPdfVersion(0); }
    catch (e: unknown) { setError((e as Error).message); }
  }

  async function removeProblem(pid: number) {
    try { setProbs(await contests.removeProblem(contestId, pid)); setPdfVersion(0); }
    catch (e: unknown) { setError((e as Error).message); }
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= probs.length) return;
    const order = probs.map(p => p.problemId);
    [order[i], order[j]] = [order[j], order[i]];
    try { setProbs(await contests.reorder(contestId, order)); setPdfVersion(0); }
    catch (e: unknown) { setError((e as Error).message); }
  }

  async function compile() {
    setCompiling(true); setError(''); setMsg(''); setCompileLog(''); setShowLog(false);
    try {
      const r = await contests.compile(contestId, pdfLang, kind);
      setCompileLog(r.log || '');
      if (r.ok) { setPdfVersion(v => v + 1); setMsg(`${kind} compiled`); }
      else { setShowLog(true); setError('Compilation failed — see log'); }
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setCompiling(false); }
  }

  if (!contest) return <div className="content">{error ? <div className="alert alert-error">{error}</div> : 'Loading…'}</div>;

  const inContest = new Set(probs.map(p => p.problemId));
  const addable = allProblems.filter(p => !inContest.has(p.id));

  return (
    <div className="content">
      <div className="breadcrumb"><Link to="/contests">Contests</Link> &rsaquo; {contest.name || '(unnamed)'}</div>

      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {/* Contest properties */}
      <div className="section-header">Contest properties</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 16 }}>
        <label style={{ fontSize: 12 }}>Name<br /><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ width: 240, border: '1px solid #aaa', padding: '3px 6px' }} /></label>
        <label style={{ fontSize: 12 }}>Date<br /><input value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} placeholder="15.06.2026" style={{ width: 120, border: '1px solid #aaa', padding: '3px 6px' }} /></label>
        <label style={{ fontSize: 12 }}>Location<br /><input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} style={{ width: 200, border: '1px solid #aaa', padding: '3px 6px' }} /></label>
        <label style={{ fontSize: 12 }}>Language<br /><select value={form.language} onChange={e => setForm({ ...form, language: e.target.value })} style={{ padding: '3px 6px' }}>{LANGS.map(l => <option key={l} value={l}>{l}</option>)}</select></label>
        <button className="btn btn-primary btn-sm" onClick={saveFields}>Save</button>
      </div>

      {/* Share access */}
      {contest.isOwner && (
        <div style={{ marginBottom: 16 }}>
          <div className="section-header">Share access</div>
          <ShareManager
            note="Shared users get access to this contest and all of its problems. Removing a user revokes access to the contest and its problems."
            load={() => contests.shares(contestId)}
            add={(u) => contests.share(contestId, u)}
            remove={(u) => contests.unshare(contestId, u)}
          />
        </div>
      )}

      {/* Problems */}
      <div className="section-header">Problems ({probs.length})</div>
      <table className="poly-table" style={{ marginBottom: 8 }}>
        <thead><tr><th style={{ width: 40 }}>#</th><th>Name</th><th style={{ width: 60 }}>Rev</th><th style={{ width: 160 }}>Order</th><th style={{ width: 80 }}>Action</th></tr></thead>
        <tbody>
          {probs.map((p, i) => (
            <tr key={p.problemId}>
              <td style={{ fontWeight: 'bold' }}>{p.index}</td>
              <td><Link to={`/problem/${p.problemId}`}>{p.shortName}</Link></td>
              <td>{p.revision}</td>
              <td>
                <button className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>{' '}
                <button className="btn btn-sm" disabled={i === probs.length - 1} onClick={() => move(i, 1)}>↓</button>
              </td>
              <td><button className="btn btn-sm btn-danger" onClick={() => removeProblem(p.problemId)}>Remove</button></td>
            </tr>
          ))}
          {probs.length === 0 && <tr><td colSpan={5} style={{ color: '#888', textAlign: 'center', padding: 10 }}>No problems — add some below</td></tr>}
        </tbody>
      </table>

      <div className="flex" style={{ marginBottom: 20 }}>
        <select value={addId} onChange={e => setAddId(e.target.value)} style={{ padding: '3px 6px', minWidth: 240 }}>
          <option value="">— add a problem —</option>
          {addable.map(p => <option key={p.id} value={p.id}>{p.shortName}</option>)}
        </select>
        <button className="btn btn-sm" onClick={addProblem} disabled={!addId}>Add</button>
      </div>

      {/* Combined PDF */}
      <div className="section-header">Statements PDF</div>
      <div className="flex" style={{ margin: '8px 0' }}>
        <select value={kind} onChange={e => setKind(e.target.value as 'statements' | 'tutorials')} style={{ padding: '3px 6px' }}>
          <option value="statements">Statements</option>
          <option value="tutorials">Tutorials</option>
        </select>
        <select value={pdfLang} onChange={e => setPdfLang(e.target.value)} style={{ padding: '3px 6px' }}>{LANGS.map(l => <option key={l} value={l}>{l}</option>)}</select>
        <button className="btn btn-primary btn-sm" onClick={compile} disabled={compiling || probs.length === 0}>
          {compiling ? <><span className="spinner" style={{ marginRight: 4 }} />Compiling…</> : 'Compile PDF'}
        </button>
        {pdfVersion > 0 && (
          <a className="btn btn-sm" href={contests.pdfUrl(contestId, pdfLang, kind, true)} target="_blank" rel="noreferrer">Download</a>
        )}
        {compileLog && <button className="btn btn-sm" onClick={() => setShowLog(s => !s)}>{showLog ? 'Hide log' : 'Show log'}</button>}
      </div>

      {showLog && compileLog && (
        <pre style={{ padding: 10, maxHeight: 180, overflow: 'auto', fontSize: 11, background: '#1e1e1e', color: '#e0a0a0', whiteSpace: 'pre-wrap' }}>{compileLog}</pre>
      )}

      {pdfVersion > 0 && (
        <iframe title="contest-pdf" src={`${contests.pdfUrl(contestId, pdfLang, kind)}&v=${pdfVersion}`}
          style={{ width: '100%', height: '80vh', border: '1px solid var(--border, #ccc)', marginTop: 8 }} />
      )}
    </div>
  );
}
