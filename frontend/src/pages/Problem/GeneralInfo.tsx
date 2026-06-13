import React, { useState } from 'react';
import { problems, ProblemInfo } from '../../api/client';

interface Props { problemId: number; info: ProblemInfo; onUpdate: () => void; }

export default function GeneralInfo({ problemId, info, onUpdate }: Props) {
  const [name, setName] = useState(info.names[0]?.value ?? '');
  const [lang, setLang] = useState(info.names[0]?.language ?? 'russian');
  const [timeLimit, setTimeLimit] = useState(String(info.timeLimit));
  const [memoryLimit, setMemoryLimit] = useState(String(Math.round(info.memoryLimit / 1024 / 1024)));
  const [inputFile, setInputFile] = useState(info.inputFile);
  const [outputFile, setOutputFile] = useState(info.outputFile);
  const [interactive, setInteractive] = useState(info.interactive);
  const [runCount, setRunCount] = useState(String(info.runCount));
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      await problems.updateInfo({
        problemId,
        name,
        language: lang,
        timeLimit,
        memoryLimit: String(parseInt(memoryLimit) * 1024 * 1024),
        inputFile,
        outputFile,
        interactive: String(interactive),
        runCount,
      });
      setMsg('Saved');
      onUpdate();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h2>General Info</h2>
      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={handleSave}>
        <div className="form-row">
          <label>Short name:</label>
          <span style={{ fontFamily: 'monospace' }}>{info.shortName}</span>
        </div>
        <div className="form-row">
          <label>Language:</label>
          <select value={lang} onChange={e => setLang(e.target.value)}>
            <option value="russian">Russian</option>
            <option value="english">English</option>
            <option value="chinese">Chinese</option>
          </select>
        </div>
        <div className="form-row">
          <label>Name ({lang}):</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} style={{ width: 300 }} />
        </div>
        <div className="form-row">
          <label>Time limit (ms):</label>
          <input type="number" value={timeLimit} onChange={e => setTimeLimit(e.target.value)} style={{ width: 100 }} />
        </div>
        <div className="form-row">
          <label>Memory limit (MB):</label>
          <input type="number" value={memoryLimit} onChange={e => setMemoryLimit(e.target.value)} style={{ width: 100 }} />
        </div>
        <div className="form-row">
          <label>Input file:</label>
          <input type="text" value={inputFile} onChange={e => setInputFile(e.target.value)}
            placeholder="stdin" style={{ width: 160 }} />
          <span style={{ color: '#888', fontSize: 11 }}>Leave blank for stdin</span>
        </div>
        <div className="form-row">
          <label>Output file:</label>
          <input type="text" value={outputFile} onChange={e => setOutputFile(e.target.value)}
            placeholder="stdout" style={{ width: 160 }} />
        </div>
        <div className="form-row">
          <label>Interactive:</label>
          <input type="checkbox" checked={interactive} onChange={e => setInteractive(e.target.checked)} />
        </div>
        <div className="form-row">
          <label>Run count:</label>
          <input type="number" value={runCount} onChange={e => setRunCount(e.target.value)} style={{ width: 80 }} />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">Save</button>
        </div>
      </form>

      <hr style={{ margin: '16px 0' }} />
      <div>
        <strong>Names:</strong>
        <table className="poly-table" style={{ width: 'auto', marginTop: 4 }}>
          <thead><tr><th>Language</th><th>Name</th></tr></thead>
          <tbody>
            {info.names.map(n => (
              <tr key={n.language}><td>{n.language}</td><td>{n.value}</td></tr>
            ))}
            {info.names.length === 0 && <tr><td colSpan={2} style={{ color: '#888' }}>No names set</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
