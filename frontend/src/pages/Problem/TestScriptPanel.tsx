import React, { useState, useEffect } from 'react';
import { problems } from '../../api/client';
import CodeEditor from '../../components/CodeEditor';

interface Props { problemId: number; onApplied: () => void; }

/**
 * Polygon-style test script panel: write a FreeMarker template whose expanded
 * lines are generator commands (`gen arg1 arg2 ...`). Supports preview of the
 * expanded command lines, a one-line run preview, and applying the script to
 * create generated tests (append or replace existing generated tests).
 */
export default function TestScriptPanel({ problemId, onApplied }: Props) {
  const [open, setOpen] = useState(false);
  const [script, setScript] = useState('');
  const [lines, setLines] = useState<string[] | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [linePreview, setLinePreview] = useState<{ line: string; text: string } | null>(null);

  useEffect(() => {
    if (open) problems.testScript(problemId).then(r => setScript(r.script)).catch(() => {});
  }, [open, problemId]);

  async function doExpand() {
    setError(''); setMsg(''); setLines(null);
    try {
      const r = await problems.expandTestScript(problemId, script);
      setLines(r.lines);
      setMsg(`Script expands to ${r.count} test(s)`);
    } catch (e: unknown) { setError((e as Error).message); }
  }

  async function doSave() {
    setError(''); setMsg('');
    try { await problems.saveTestScript(problemId, script); setMsg('Script saved'); }
    catch (e: unknown) { setError((e as Error).message); }
  }

  async function doApply(mode: 'append' | 'replace') {
    if (mode === 'replace' && !confirm('Replace all existing generated tests with the script output?')) return;
    setError(''); setMsg(''); setBusy(true);
    try {
      const r = await problems.applyTestScript(problemId, script, mode);
      setMsg(`Created ${r.count} generated test(s) (${mode})`);
      onApplied();
    } catch (e: unknown) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function previewLine(line: string) {
    setError(''); setLinePreview({ line, text: 'Running…' });
    try {
      const r = await problems.previewScriptLine(problemId, line);
      setLinePreview({ line, text: r.preview + (r.truncated ? '\n… (truncated)' : '') });
    } catch (e: unknown) { setLinePreview({ line, text: 'Error: ' + (e as Error).message }); }
  }

  return (
    <div style={{ border: '1px solid var(--border, #ddd)', borderRadius: 4, marginBottom: 12 }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ padding: '6px 10px', cursor: 'pointer', background: 'var(--surface-2, #f6f8fa)', fontWeight: 600, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <span>{open ? '▾' : '▸'}</span> Test script (generators / FreeMarker)
      </div>
      {open && (
        <div style={{ padding: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted, #666)', marginBottom: 6 }}>
            Each expanded line is a generator command, e.g. <code>gen 10 5</code>. FreeMarker:&nbsp;
            <code>{'<#list 1..10 as i>gen ${i} ${i*2}\\n</#list>'}</code>
          </div>
          <CodeEditor value={script} onChange={setScript} language="plaintext" height={180} onSave={doSave} />

          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={doExpand}>Expand preview</button>
            <button className="btn btn-sm" onClick={doSave}>Save script</button>
            <button className="btn btn-sm btn-primary" onClick={() => doApply('append')} disabled={busy}>Apply (append)</button>
            <button className="btn btn-sm btn-danger" onClick={() => doApply('replace')} disabled={busy}>Apply (replace generated)</button>
          </div>

          {msg && <div className="alert alert-success" style={{ marginTop: 8 }}>{msg}</div>}
          {error && <div className="alert alert-error" style={{ marginTop: 8 }}>{error}</div>}

          {lines && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--muted, #666)', marginBottom: 4 }}>{lines.length} command(s):</div>
              <div className="code-view" style={{ maxHeight: 200 }}>
                {lines.map((l, k) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{l}</span>
                    <a className="poly-link" style={{ fontSize: 11 }} onClick={() => previewLine(l)}>run</a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {linePreview && (
            <div style={{ marginTop: 8 }}>
              <div className="flex-between" style={{ marginBottom: 4 }}>
                <strong style={{ fontSize: 12 }}>Output of: <code>{linePreview.line}</code></strong>
                <button className="btn btn-sm" onClick={() => setLinePreview(null)}>Close</button>
              </div>
              <div className="code-view" style={{ maxHeight: 240 }}>{linePreview.text}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
