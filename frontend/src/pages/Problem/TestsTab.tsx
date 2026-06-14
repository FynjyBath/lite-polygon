import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { problems, TestPreview, TestGroup, ProblemInfo } from '../../api/client';
import TestScriptPanel from './TestScriptPanel';

// Natural sort so test10 comes after test2, not after test1.
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
const ANSWER_EXT = /\.(a|ans|out|expected)$/i;

interface Props { problemId: number; info: ProblemInfo; }

type RowEdit = { desc: string; group: string; points: string };

function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' KB';
}

export default function TestsAndGroupsTab({ problemId, info }: Props) {
  const [tests, setTests] = useState<TestPreview[]>([]);
  const [groups, setGroups] = useState<TestGroup[]>([]);
  const [editRows, setEditRows] = useState<Record<number, RowEdit>>({});
  const [viewInput, setViewInput] = useState<{ idx: number; content: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newTest, setNewTest] = useState({ method: 'manual', input: '', cmd: '', description: '', sample: false, group: '', points: '0' });
  const [newGroup, setNewGroup] = useState({ name: '', points: '0', pointsPolicy: 'complete-group', feedbackPolicy: 'icpc', dependencies: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const uploadRef = useRef<HTMLInputElement>(null);

  // Multi-select state
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkGroup, setBulkGroup] = useState('');
  const [bulkPoints, setBulkPoints] = useState('');
  const [bulkWorking, setBulkWorking] = useState(false);
  const [moveToIdx, setMoveToIdx] = useState('');
  const lastClickedRef = useRef<number | null>(null);

  // Answer generation progress
  const [genProgress, setGenProgress] = useState<{ done: number; total: number; generated: number; errorCount: number } | null>(null);

  // Zip import + drag-and-drop reordering
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  useEffect(() => { reload(); }, [problemId]);

  function reload() {
    problems.previewTests(problemId).then(ts => {
      setTests(ts);
      const rows: Record<number, RowEdit> = {};
      for (const t of ts) rows[t.idx] = { desc: t.description, group: t.group_name, points: String(t.points || 0) };
      setEditRows(rows);
    }).catch(e => setError(e.message));
    problems.viewTestGroup(problemId).then(setGroups).catch(() => {});
  }

  // ── Generate Answers ──────────────────────────────────────────────────────
  async function handleGenerateAnswers() {
    setMsg(''); setError(''); setGenerating(true);
    setGenProgress({ done: 0, total: 0, generated: 0, errorCount: 0 });
    try {
      const start = await problems.generateAnswers(problemId);
      setGenProgress({ done: start.done, total: start.total, generated: start.generated, errorCount: start.errorCount });
      // Poll progress until the job finishes.
      for (;;) {
        await new Promise(r => setTimeout(r, 700));
        const p = await problems.generateAnswersProgress(problemId);
        setGenProgress({ done: p.done, total: p.total, generated: p.generated, errorCount: p.errorCount });
        if (!p.running) {
          setMsg(`Generated ${p.generated}/${p.total} answer(s)` +
            (p.errorCount ? ` — ${p.errorCount} error(s): ${p.errors.slice(0, 3).join('; ')}${p.errorCount > 3 ? '…' : ''}` : ''));
          reload();
          break;
        }
      }
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setGenerating(false); setGenProgress(null); }
  }

  // ── Upload test files ─────────────────────────────────────────────────────
  async function handleUploadTests(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true); setMsg(''); setError('');
    let added = 0;
    for (const file of files) {
      try {
        const content = await readFile(file);
        await problems.saveTest({ problemId, method: 'manual', input: content, sample: 'false', description: file.name });
        added++;
      } catch (err: unknown) { setError((err as Error).message); break; }
    }
    setMsg(`Uploaded ${added} test(s)`);
    setUploading(false);
    if (uploadRef.current) uploadRef.current.value = '';
    reload();
  }

  function readFile(file: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(new Error('Read error'));
      r.readAsText(file);
    });
  }

  // ── Inline row edit ───────────────────────────────────────────────────────
  function setRow(idx: number, patch: Partial<RowEdit>) {
    setEditRows(r => ({ ...r, [idx]: { ...r[idx], ...patch } }));
  }

  async function saveRow(t: TestPreview) {
    const row = editRows[t.idx];
    if (!row) return;
    const changed = row.desc !== t.description || row.group !== t.group_name || row.points !== String(t.points || 0);
    if (!changed) return;
    try {
      await problems.updateTest(problemId, t.idx, { description: row.desc, group: row.group, points: parseFloat(row.points) || 0 });
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  async function toggleSample(t: TestPreview) {
    try {
      await problems.updateTest(problemId, t.idx, { sample: !t.sample });
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  // ── Move test ─────────────────────────────────────────────────────────────
  async function handleMove(idx: number, direction: 'up' | 'down') {
    try {
      await problems.moveTest(problemId, idx, direction);
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  // ── Delete test ───────────────────────────────────────────────────────────
  async function handleDelete(idx: number) {
    if (!confirm(`Delete test ${idx}?`)) return;
    try { await problems.deleteTest(problemId, idx); reload(); }
    catch (err: unknown) { setError((err as Error).message); }
  }

  // ── View input ────────────────────────────────────────────────────────────
  async function handleViewInput(idx: number) {
    try {
      const url = problems.testInput(problemId, idx);
      const res = await fetch(url, { credentials: 'include' });
      const text = await res.text();
      setViewInput({ idx, content: text.slice(0, 3000) });
    } catch { setViewInput({ idx, content: 'Failed to load' }); }
  }

  // ── Add test ──────────────────────────────────────────────────────────────
  async function handleAddTest(e: React.FormEvent) {
    e.preventDefault(); setMsg(''); setError('');
    try {
      await problems.saveTest({
        problemId, method: newTest.method,
        input: newTest.method === 'manual' ? newTest.input : undefined,
        cmd: newTest.method === 'generated' ? newTest.cmd : undefined,
        scriptLine: newTest.method === 'generated' ? newTest.cmd : undefined,
        description: newTest.description,
        sample: String(newTest.sample),
        group: newTest.group, points: newTest.points,
      });
      setNewTest({ method: 'manual', input: '', cmd: '', description: '', sample: false, group: '', points: '0' });
      setMsg('Test added'); reload();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  // ── Multi-select ──────────────────────────────────────────────────────────
  function toggleSelect(idx: number) {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === tests.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(tests.map(t => t.idx)));
    }
  }

  function handleCheckboxClick(e: React.MouseEvent<HTMLInputElement>, idx: number) {
    if (e.shiftKey && lastClickedRef.current !== null) {
      e.preventDefault();
      const from = Math.min(lastClickedRef.current, idx);
      const to = Math.max(lastClickedRef.current, idx);
      const rangeIdxs = tests.filter(t => t.idx >= from && t.idx <= to).map(t => t.idx);
      const allInRange = rangeIdxs.every(i => selected.has(i));
      setSelected(s => {
        const next = new Set(s);
        rangeIdxs.forEach(i => { if (allInRange) next.delete(i); else next.add(i); });
        return next;
      });
    } else {
      toggleSelect(idx);
      lastClickedRef.current = idx;
    }
  }

  // ── Bulk operations ───────────────────────────────────────────────────────
  async function bulkSetSample(value: boolean) {
    if (!selected.size) return;
    setBulkWorking(true); setMsg(''); setError('');
    try {
      await Promise.all([...selected].map(idx => problems.updateTest(problemId, idx, { sample: value })));
      setMsg(`Set sample=${value} for ${selected.size} test(s)`);
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setBulkWorking(false); }
  }

  async function bulkSetGroup() {
    if (!selected.size) return;
    setBulkWorking(true); setMsg(''); setError('');
    try {
      await Promise.all([...selected].map(idx => problems.updateTest(problemId, idx, { group: bulkGroup })));
      setMsg(`Set group="${bulkGroup}" for ${selected.size} test(s)`);
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setBulkWorking(false); }
  }

  async function bulkSetPoints() {
    if (!selected.size) return;
    const pts = parseFloat(bulkPoints) || 0;
    setBulkWorking(true); setMsg(''); setError('');
    try {
      await Promise.all([...selected].map(idx => problems.updateTest(problemId, idx, { points: pts })));
      setMsg(`Set points=${pts} for ${selected.size} test(s)`);
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setBulkWorking(false); }
  }

  async function bulkDelete() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} selected test(s)?`)) return;
    setBulkWorking(true); setMsg(''); setError('');
    // Delete from highest index first to avoid index shifts
    const sorted = [...selected].sort((a, b) => b - a);
    try {
      for (const idx of sorted) {
        await problems.deleteTest(problemId, idx);
      }
      setMsg(`Deleted ${sorted.length} test(s)`);
      setSelected(new Set());
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setBulkWorking(false); }
  }

  // ── Import tests from a zip archive ───────────────────────────────────────
  async function handleImportZip(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (zipRef.current) zipRef.current.value = '';
    if (!file) return;
    setMsg(''); setError('');
    try {
      const zip = await JSZip.loadAsync(file);
      // Collect plain files (ignore directories and macOS metadata).
      const entries = Object.values(zip.files).filter(f => !f.dir && !f.name.includes('__MACOSX') && !f.name.split('/').pop()!.startsWith('.'));
      // Treat answer-looking files as answers; everything else is an input.
      let inputs = entries.filter(f => !ANSWER_EXT.test(f.name));
      if (inputs.length === 0) inputs = entries; // archive had only e.g. *.out — import them all
      inputs.sort((a, b) => naturalCompare(a.name, b.name));
      if (inputs.length === 0) { setError('No test files found in archive'); return; }

      setZipProgress({ done: 0, total: inputs.length });
      let added = 0;
      for (const entry of inputs) {
        const content = await entry.async('string');
        const base = entry.name.split('/').pop() || entry.name;
        await problems.saveTest({ problemId, method: 'manual', input: content, sample: 'false', description: base });
        added++;
        setZipProgress({ done: added, total: inputs.length });
      }
      setMsg(`Imported ${added} test(s) from ${file.name}`);
      reload();
    } catch (err: unknown) {
      setError('Zip import failed: ' + (err as Error).message);
    } finally {
      setZipProgress(null);
    }
  }

  // ── Drag-and-drop reordering ──────────────────────────────────────────────
  async function handleDropReorder(targetIdx: number) {
    const src = dragIdx;
    setDragIdx(null); setDragOverIdx(null);
    if (src == null || src === targetIdx) return;
    // moveTestsTo inserts the moved test *before* position `targetIdx` (1-based
    // over the list without the moved item); dropping below means +0, above same.
    const target = src < targetIdx ? targetIdx : targetIdx;
    setBulkWorking(true); setMsg(''); setError('');
    try {
      await problems.moveTestsTo(problemId, [src], target);
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setBulkWorking(false); }
  }

  async function handleMoveTo() {
    if (!selected.size || !moveToIdx) return;
    const target = parseInt(moveToIdx);
    if (!target || target < 1) return;
    setBulkWorking(true); setMsg(''); setError('');
    try {
      const result = await problems.moveTestsTo(problemId, [...selected], target);
      setMsg(`Moved ${selected.size} test(s); tests renumbered 1–${result.count}`);
      setSelected(new Set());
      lastClickedRef.current = null;
      setMoveToIdx('');
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
    finally { setBulkWorking(false); }
  }

  // ── Groups ────────────────────────────────────────────────────────────────
  async function handleSaveGroup(e: React.FormEvent) {
    e.preventDefault(); setMsg(''); setError('');
    try {
      await problems.saveTestGroup({
        problemId, groupName: newGroup.name, points: newGroup.points,
        pointsPolicy: newGroup.pointsPolicy, feedbackPolicy: newGroup.feedbackPolicy,
        dependencies: newGroup.dependencies,
      });
      setNewGroup({ name: '', points: '0', pointsPolicy: 'complete-group', feedbackPolicy: 'icpc', dependencies: '' });
      setMsg('Group saved'); reload();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  async function updateGroupField(g: TestGroup, field: string, value: string) {
    try {
      const patch: Record<string, string | number> = { problemId, groupName: g.name };
      if (field === 'points') patch.points = value;
      if (field === 'pointsPolicy') patch.pointsPolicy = value;
      if (field === 'feedbackPolicy') patch.feedbackPolicy = value;
      await problems.saveTestGroup(patch as Record<string, unknown>);
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  async function removeGroupDep(g: TestGroup, dep: string) {
    try {
      const newDeps = g.dependencies.filter(d => d !== dep);
      await problems.saveTestGroup({ problemId, groupName: g.name, dependencies: newDeps.join(',') });
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  async function addGroupDep(g: TestGroup, dep: string) {
    if (!dep.trim()) return;
    try {
      const newDeps = [...new Set([...g.dependencies, dep.trim()])];
      await problems.saveTestGroup({ problemId, groupName: g.name, dependencies: newDeps.join(',') });
      reload();
    } catch (err: unknown) { setError((err as Error).message); }
  }

  const allSelected = tests.length > 0 && selected.size === tests.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div style={{ paddingBottom: selected.size > 0 ? 64 : 0 }}>
      {/* Header */}
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <h2>Tests ({tests.length})</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-sm" onClick={handleGenerateAnswers} disabled={generating}>
            {generating
              ? (genProgress && genProgress.total
                  ? <><span className="spinner" style={{ marginRight: 4 }} />Generating {genProgress.done}/{genProgress.total}…</>
                  : <><span className="spinner" style={{ marginRight: 4 }} />Generating…</>)
              : 'Generate Answers'}
          </button>
          <label className="btn btn-sm" style={{ cursor: 'pointer', marginBottom: 0 }}>
            {uploading ? 'Uploading…' : 'Upload Tests'}
            <input ref={uploadRef} type="file" multiple style={{ display: 'none' }} onChange={handleUploadTests} />
          </label>
          <label className="btn btn-sm" style={{ cursor: 'pointer', marginBottom: 0 }}>
            {zipProgress ? `Importing ${zipProgress.done}/${zipProgress.total}…` : 'Import zip'}
            <input ref={zipRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleImportZip} disabled={!!zipProgress} />
          </label>
        </div>
      </div>
      {zipProgress && (
        <div className="progress-bar"><div className="progress-bar-fill" style={{ width: `${Math.round(100 * zipProgress.done / zipProgress.total)}%` }} /></div>
      )}
      {generating && genProgress && (
        <div style={{ margin: '6px 0' }}>
          <div style={{ fontSize: 12, color: 'var(--muted, #666)', marginBottom: 3 }}>
            Generating answers: {genProgress.done}/{genProgress.total || '?'}
            {genProgress.generated ? ` · ${genProgress.generated} ok` : ''}
            {genProgress.errorCount ? ` · ${genProgress.errorCount} error(s)` : ''}
          </div>
          {genProgress.total
            ? <div className="progress-bar"><div className="progress-bar-fill" style={{ width: `${Math.round(100 * genProgress.done / genProgress.total)}%` }} /></div>
            : <div className="progress-bar"><div className="progress-bar-fill-indeterminate" /></div>}
        </div>
      )}

      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <TestScriptPanel problemId={problemId} onApplied={reload} />

      {/* Bulk action bar — floats at the bottom of the viewport so it is
          reachable without scrolling back to the top of the page */}
      {selected.size > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
          padding: '8px 14px', background: 'var(--surface-2, #eef4ff)',
          border: '1px solid var(--border, #c8d8f8)',
          borderRadius: 8, fontSize: 12,
          position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)',
          zIndex: 900, maxWidth: 'calc(100vw - 32px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
        }}>
          <strong style={{ color: '#2264b0' }}>{selected.size} selected:</strong>
          <button className="btn btn-sm" onClick={() => bulkSetSample(true)} disabled={bulkWorking}>→ Sample</button>
          <button className="btn btn-sm" onClick={() => bulkSetSample(false)} disabled={bulkWorking}>→ Not Sample</button>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Group:
            <input
              value={bulkGroup}
              onChange={e => setBulkGroup(e.target.value)}
              style={{ width: 60, fontSize: 12, padding: '1px 4px', border: '1px solid #aaa' }}
            />
            <button className="btn btn-sm" onClick={bulkSetGroup} disabled={bulkWorking}>Apply</button>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Points:
            <input
              type="number"
              value={bulkPoints}
              onChange={e => setBulkPoints(e.target.value)}
              style={{ width: 60, fontSize: 12, padding: '1px 4px', border: '1px solid #aaa' }}
            />
            <button className="btn btn-sm" onClick={bulkSetPoints} disabled={bulkWorking}>Apply</button>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Move to:
            <input
              type="number"
              min="1"
              max={tests.length}
              value={moveToIdx}
              onChange={e => setMoveToIdx(e.target.value)}
              style={{ width: 56, fontSize: 12, padding: '1px 4px', border: '1px solid #aaa' }}
            />
            <button className="btn btn-sm" onClick={handleMoveTo} disabled={bulkWorking || !moveToIdx}>Go</button>
          </span>
          <button className="btn btn-sm btn-danger" onClick={bulkDelete} disabled={bulkWorking}>Delete</button>
          <button className="btn btn-sm" onClick={() => { setSelected(new Set()); lastClickedRef.current = null; }} style={{ marginLeft: 4 }}>✕ Clear</button>
        </div>
      )}

      {/* Tests table */}
      <div style={{ overflowX: 'auto', marginBottom: 16 }}>
        <table className="poly-table" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleSelectAll}
                  title="Select all"
                />
              </th>
              <th style={{ width: 30 }}>#</th>
              <th style={{ width: 18 }} title="Drag to reorder"></th>
              <th style={{ width: 160 }}>Content</th>
              <th style={{ width: 60 }}>Size</th>
              <th style={{ width: 120 }}>Desc</th>
              <th style={{ width: 36 }} title="Sample/Example">Ex</th>
              <th style={{ width: 60 }}>Group</th>
              <th style={{ width: 60 }}>Points</th>
              <th style={{ width: 44 }}>Input</th>
              <th style={{ width: 48 }}>Answer</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tests.map((t, i) => {
              const row = editRows[t.idx] ?? { desc: t.description, group: t.group_name, points: String(t.points || 0) };
              const isSelected = selected.has(t.idx);
              return (
                <tr
                  key={t.idx}
                  onDragOver={dragIdx != null ? (e => { e.preventDefault(); setDragOverIdx(t.idx); }) : undefined}
                  onDrop={dragIdx != null ? (() => handleDropReorder(t.idx)) : undefined}
                  style={{
                    background: dragOverIdx === t.idx && dragIdx !== t.idx ? '#dbe9ff'
                      : isSelected ? '#f0f6ff' : undefined,
                    borderTop: dragOverIdx === t.idx && dragIdx !== t.idx ? '2px solid #4472c4' : undefined,
                    opacity: dragIdx === t.idx ? 0.4 : 1,
                  }}
                >
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      onClick={(e) => handleCheckboxClick(e as unknown as React.MouseEvent<HTMLInputElement>, t.idx)}
                    />
                  </td>
                  <td style={{ textAlign: 'center', color: '#666' }}>{t.idx}</td>
                  <td
                    draggable
                    onDragStart={() => setDragIdx(t.idx)}
                    onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                    title="Drag to reorder"
                    style={{ cursor: 'grab', textAlign: 'center', color: '#999', userSelect: 'none' }}
                  >⠿</td>
                  <td>
                    {t.inputAvailable
                      ? <div className="input-preview" style={{ maxHeight: 48, fontSize: 10, cursor: 'pointer' }} onClick={() => handleViewInput(t.idx)}>{t.inputPreview}</div>
                      : <span style={{ color: '#bbb', fontSize: 11 }}>no input</span>}
                  </td>
                  <td style={{ color: '#666', fontSize: 11 }}>{t.inputAvailable ? fmtSize(t.inputSize) : '—'}</td>
                  <td>
                    <input
                      value={row.desc}
                      onChange={ev => setRow(t.idx, { desc: ev.target.value })}
                      onBlur={() => saveRow(t)}
                      onKeyDown={e => e.key === 'Enter' && saveRow(t)}
                      style={{ width: '100%', border: '1px solid #ddd', padding: '1px 4px', fontSize: 11 }}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      className="btn btn-sm"
                      style={{
                        padding: '1px 6px', fontSize: 11,
                        background: t.sample ? '#efe' : '#f4f4f4',
                        borderColor: t.sample ? '#9c9' : '#ccc',
                        color: t.sample ? '#060' : '#aaa',
                        fontWeight: t.sample ? 'bold' : 'normal',
                      }}
                      onClick={() => toggleSample(t)}
                      title="Toggle sample/example"
                    >
                      {t.sample ? 'Y' : '—'}
                    </button>
                  </td>
                  <td>
                    <input
                      value={row.group}
                      onChange={ev => setRow(t.idx, { group: ev.target.value })}
                      onBlur={() => saveRow(t)}
                      onKeyDown={e => e.key === 'Enter' && saveRow(t)}
                      style={{ width: 52, border: '1px solid #ddd', padding: '1px 4px', fontSize: 11 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={row.points}
                      onChange={ev => setRow(t.idx, { points: ev.target.value })}
                      onBlur={() => saveRow(t)}
                      onKeyDown={e => e.key === 'Enter' && saveRow(t)}
                      style={{ width: 52, border: '1px solid #ddd', padding: '1px 4px', fontSize: 11 }}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {t.inputAvailable
                      ? <a href={problems.testInput(problemId, t.idx)} target="_blank" rel="noreferrer" className="btn btn-sm">↓</a>
                      : <span style={{ color: '#ccc', fontSize: 10 }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {t.answerAvailable
                      ? <a href={problems.testAnswer(problemId, t.idx)} target="_blank" rel="noreferrer" className="btn btn-sm">↓</a>
                      : <span style={{ color: '#ccc', fontSize: 10 }}>—</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(t.idx)} title="Delete">Del</button>
                    {' '}
                    <button className="btn btn-sm" onClick={() => handleMove(t.idx, 'up')} disabled={i === 0} title="Move up">↑</button>
                    {' '}
                    <button className="btn btn-sm" onClick={() => handleMove(t.idx, 'down')} disabled={i === tests.length - 1} title="Move down">↓</button>
                    {' '}
                    <button className="btn btn-sm" onClick={() => handleViewInput(t.idx)} disabled={!t.inputAvailable} title="View input">View</button>
                  </td>
                </tr>
              );
            })}
            {tests.length === 0 && (
              <tr><td colSpan={12} style={{ color: '#888', textAlign: 'center', padding: 12 }}>No tests yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Input preview panel */}
      {viewInput && (
        <div style={{ marginBottom: 12 }}>
          <div className="flex-between" style={{ marginBottom: 4 }}>
            <strong>Test {viewInput.idx}:</strong>
            <button className="btn btn-sm" onClick={() => setViewInput(null)}>Close</button>
          </div>
          <div className="code-view">{viewInput.content}</div>
        </div>
      )}

      {/* ── Groups section ─────────────────────────────────────────────── */}
      {groups.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="section-header" style={{ marginBottom: 8 }}>Groups points policy and dependencies</div>
          <div style={{ overflowX: 'auto' }}>
            <table className="poly-table" style={{ minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Name</th>
                  <th style={{ width: 50 }}>Tests</th>
                  <th style={{ width: 60 }}>Points</th>
                  <th style={{ width: 160 }}>Points policy</th>
                  <th style={{ width: 140 }}>Feedback policy</th>
                  <th>Dependencies</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(g => (
                  <GroupRow
                    key={g.id}
                    group={g}
                    testCount={tests.filter(t => t.group_name === g.name).length}
                    onUpdateField={updateGroupField}
                    onRemoveDep={removeGroupDep}
                    onAddDep={addGroupDep}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Add Group form ─────────────────────────────────────────────── */}
      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', color: '#2264b0', fontSize: 12, marginBottom: 4 }}>
          {groups.length === 0 ? '+ Add Group / Enable Groups' : '+ Add/Edit Group'}
        </summary>
        <div style={{ paddingTop: 8 }}>
          <form onSubmit={handleSaveGroup}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
              <label style={{ fontSize: 12 }}>
                Name:&nbsp;
                <input value={newGroup.name} onChange={e => setNewGroup({ ...newGroup, name: e.target.value })}
                  required style={{ width: 60, fontSize: 12, padding: '2px 4px', border: '1px solid #aaa' }} />
              </label>
              <label style={{ fontSize: 12 }}>
                Points:&nbsp;
                <input type="number" value={newGroup.points} onChange={e => setNewGroup({ ...newGroup, points: e.target.value })}
                  style={{ width: 60, fontSize: 12, padding: '2px 4px', border: '1px solid #aaa' }} />
              </label>
              <label style={{ fontSize: 12 }}>
                Points policy:&nbsp;
                <select value={newGroup.pointsPolicy} onChange={e => setNewGroup({ ...newGroup, pointsPolicy: e.target.value })}
                  style={{ fontSize: 12 }}>
                  <option value="each-test">EACH_TEST</option>
                  <option value="complete-group">COMPLETE_GROUP</option>
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Feedback:&nbsp;
                <select value={newGroup.feedbackPolicy} onChange={e => setNewGroup({ ...newGroup, feedbackPolicy: e.target.value })}
                  style={{ fontSize: 12 }}>
                  <option value="complete">COMPLETE</option>
                  <option value="icpc">ICPC</option>
                  <option value="points">POINTS</option>
                  <option value="none">NONE</option>
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Deps (comma):&nbsp;
                <input value={newGroup.dependencies} onChange={e => setNewGroup({ ...newGroup, dependencies: e.target.value })}
                  placeholder="0,1" style={{ width: 80, fontSize: 12, padding: '2px 4px', border: '1px solid #aaa' }} />
              </label>
              <button type="submit" className="btn btn-primary btn-sm">Save Group</button>
            </div>
          </form>
        </div>
      </details>

      {/* ── Add Test form ──────────────────────────────────────────────── */}
      <details open>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#2264b0', marginBottom: 4 }}>+ Add Test</summary>
        <div style={{ paddingTop: 8 }}>
          <form onSubmit={handleAddTest}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 8 }}>
              <label style={{ fontSize: 12 }}>
                Method:&nbsp;
                <select value={newTest.method} onChange={e => setNewTest({ ...newTest, method: e.target.value })}
                  style={{ fontSize: 12 }}>
                  <option value="manual">Manual</option>
                  <option value="generated">Generated</option>
                </select>
              </label>
              <label style={{ fontSize: 12 }}>
                Desc:&nbsp;
                <input value={newTest.description} onChange={e => setNewTest({ ...newTest, description: e.target.value })}
                  style={{ width: 120, fontSize: 12, padding: '2px 4px', border: '1px solid #aaa' }} />
              </label>
              <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={newTest.sample} onChange={e => setNewTest({ ...newTest, sample: e.target.checked })} />
                Sample
              </label>
              <label style={{ fontSize: 12 }}>
                Group:&nbsp;
                <input value={newTest.group} onChange={e => setNewTest({ ...newTest, group: e.target.value })}
                  style={{ width: 50, fontSize: 12, padding: '2px 4px', border: '1px solid #aaa' }} />
              </label>
              <label style={{ fontSize: 12 }}>
                Points:&nbsp;
                <input type="number" value={newTest.points} onChange={e => setNewTest({ ...newTest, points: e.target.value })}
                  style={{ width: 60, fontSize: 12, padding: '2px 4px', border: '1px solid #aaa' }} />
              </label>
            </div>
            {newTest.method === 'manual' ? (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, marginBottom: 2 }}>Input:</div>
                <textarea
                  value={newTest.input}
                  onChange={e => setNewTest({ ...newTest, input: e.target.value })}
                  style={{ width: '100%', minHeight: 80, fontFamily: 'monospace', fontSize: 11, border: '1px solid #aaa', padding: 4, resize: 'vertical' }}
                />
              </div>
            ) : (
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 12 }}>
                  Generator command:&nbsp;
                  <input value={newTest.cmd} onChange={e => setNewTest({ ...newTest, cmd: e.target.value })}
                    placeholder="gen rand 100 42" style={{ width: 300, fontSize: 12, padding: '2px 4px', border: '1px solid #aaa' }} />
                </label>
              </div>
            )}
            <button type="submit" className="btn btn-primary btn-sm">Add Test</button>
          </form>
        </div>
      </details>
    </div>
  );
}

// ── Inline Group Row ──────────────────────────────────────────────────────────
function GroupRow({
  group, testCount, onUpdateField, onRemoveDep, onAddDep
}: {
  group: TestGroup;
  testCount: number;
  onUpdateField: (g: TestGroup, field: string, value: string) => void;
  onRemoveDep: (g: TestGroup, dep: string) => void;
  onAddDep: (g: TestGroup, dep: string) => void;
}) {
  const [editPts, setEditPts] = useState(String(group.points));
  const [addingDep, setAddingDep] = useState('');

  return (
    <tr>
      <td><strong>{group.name}</strong></td>
      <td style={{ textAlign: 'center', color: '#666' }}>{testCount}</td>
      <td>
        <input
          value={editPts}
          onChange={e => setEditPts(e.target.value)}
          onBlur={() => onUpdateField(group, 'points', editPts)}
          onKeyDown={e => e.key === 'Enter' && onUpdateField(group, 'points', editPts)}
          style={{ width: 52, fontSize: 11, padding: '1px 4px', border: '1px solid #ddd' }}
        />
      </td>
      <td>
        <select
          value={group.points_policy}
          onChange={e => onUpdateField(group, 'pointsPolicy', e.target.value)}
          style={{ fontSize: 11 }}
        >
          <option value="each-test">EACH_TEST</option>
          <option value="complete-group">COMPLETE_GROUP</option>
        </select>
      </td>
      <td>
        <select
          value={group.feedback_policy}
          onChange={e => onUpdateField(group, 'feedbackPolicy', e.target.value)}
          style={{ fontSize: 11 }}
        >
          <option value="complete">COMPLETE</option>
          <option value="icpc">ICPC</option>
          <option value="points">POINTS</option>
          <option value="none">NONE</option>
        </select>
      </td>
      <td>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {group.dependencies.map(dep => (
            <span key={dep} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: '#e8e8f8', border: '1px solid #ccd', borderRadius: 3, padding: '1px 4px', fontSize: 11 }}>
              {dep}
              <button
                onClick={() => onRemoveDep(group, dep)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a00', fontSize: 11, lineHeight: 1, padding: 0, marginLeft: 2 }}
                title="Remove dependency"
              >×</button>
            </span>
          ))}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <input
              value={addingDep}
              onChange={e => setAddingDep(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { onAddDep(group, addingDep); setAddingDep(''); } }}
              placeholder="Add…"
              style={{ width: 44, fontSize: 11, padding: '1px 4px', border: '1px solid #ccc' }}
            />
            <button
              className="btn btn-sm"
              onClick={() => { onAddDep(group, addingDep); setAddingDep(''); }}
              style={{ padding: '1px 6px', fontSize: 11 }}
            >+</button>
          </span>
        </div>
      </td>
    </tr>
  );
}
