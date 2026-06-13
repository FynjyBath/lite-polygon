import React, { useState, useEffect, useRef } from 'react';
import { problems, Asset, ProblemInfo } from '../../api/client';

interface Props { problemId: number; info: ProblemInfo; onUpdate: () => void; }

export default function InteractorTab({ problemId, info, onUpdate }: Props) {
  const [interactor, setInteractor] = useState<Asset | null>(null);
  const [sourcePath, setSourcePath] = useState('');
  const [sourceType, setSourceType] = useState('cpp.g++17');
  const [content, setContent] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { reload(); }, [problemId]);

  function reload() {
    problems.interactor(problemId).then(setInteractor).catch(() => {});
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setContent(reader.result as string);
      if (!sourcePath) setSourcePath('files/' + file.name);
    };
    reader.readAsText(file);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      if (sourcePath && content) {
        await problems.saveFile({ problemId, path: sourcePath, sourceType, content });
      }
      await problems.setInteractor({ problemId, sourcePath, sourceType });
      setMsg('Interactor saved');
      setContent('');
      if (fileRef.current) fileRef.current.value = '';
      reload(); onUpdate();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <h2>Interactor</h2>
      <p style={{ color: '#666', fontSize: 12, marginTop: 0, marginBottom: 12 }}>
        Required for interactive problems. The interactor communicates with the participant's solution via stdin/stdout.
        Mark the problem as interactive in <strong>General Info</strong>.
      </p>

      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {interactor && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f4f4f4', border: '1px solid #ddd' }}>
          <strong>Current interactor:</strong> <span className="source-type">{interactor.source_path}</span>
          {' '}(<span className="source-type">{interactor.source_type}</span>)
        </div>
      )}

      {!info.interactive && (
        <div className="alert alert-info" style={{ marginBottom: 12 }}>
          This problem is not marked as interactive. Enable it in General Info first.
        </div>
      )}

      <form onSubmit={handleSave}>
        <div className="section-header">Set Interactor</div>
        <div className="form-row">
          <label>Upload file:</label>
          <input ref={fileRef} type="file" accept=".cpp,.py,.java,.pas,.c,.go" onChange={handleFile}
            style={{ fontSize: 12 }} />
        </div>
        <div className="form-row">
          <label>Source path:</label>
          <input type="text" value={sourcePath} onChange={e => setSourcePath(e.target.value)}
            placeholder="files/interactor.cpp" style={{ width: 260 }} />
        </div>
        <div className="form-row">
          <label>Source type:</label>
          <select value={sourceType} onChange={e => setSourceType(e.target.value)}>
            <option value="cpp.g++17">cpp.g++17</option>
            <option value="cpp.g++20">cpp.g++20</option>
            <option value="cpp.gcc14-64-msys2-g++23">cpp.gcc14-64-msys2-g++23</option>
          </select>
        </div>
        {content && (
          <div className="form-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
            <label style={{ marginBottom: 4 }}>Content preview (will be saved to {sourcePath}):</label>
            <div className="code-view" style={{ maxHeight: 120 }}>{content.slice(0, 500)}{content.length > 500 ? '…' : ''}</div>
          </div>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">Set Interactor</button>
        </div>
      </form>
    </div>
  );
}
