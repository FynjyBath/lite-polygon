import React, { useState, useEffect } from 'react';
import { problems, ProblemFile, Executable } from '../../api/client';

interface Props { problemId: number; }

export default function FilesTab({ problemId }: Props) {
  const [resources, setResources] = useState<ProblemFile[]>([]);
  const [executables, setExecutables] = useState<Executable[]>([]);
  const [error, setError] = useState('');

  useEffect(() => { reload(); }, [problemId]);

  function reload() {
    problems.files(problemId).then(data => {
      setResources(data.resources);
      setExecutables(data.executables);
    }).catch(e => setError(e.message));
  }

  return (
    <div>
      <h2>Files</h2>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="section-header">Resource Files</div>
      <table className="poly-table">
        <thead>
          <tr><th>Path</th><th>Type</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {resources.map(f => (
            <tr key={f.id}>
              <td><span className="source-type">{f.path}</span></td>
              <td><span className="source-type">{f.source_type}</span></td>
              <td>
                <a
                  href={problems.viewFile(problemId, f.path)}
                  className="btn btn-sm"
                  target="_blank"
                  rel="noreferrer"
                >
                  View
                </a>
              </td>
            </tr>
          ))}
          {resources.length === 0 && (
            <tr><td colSpan={3} style={{ color: '#888' }}>No resource files</td></tr>
          )}
        </tbody>
      </table>

      <div className="section-header" style={{ marginTop: 12 }}>Executables</div>
      <table className="poly-table">
        <thead>
          <tr><th>Source</th><th>Source Type</th><th>Binary</th><th>Binary Type</th></tr>
        </thead>
        <tbody>
          {executables.map(e => (
            <tr key={e.id}>
              <td><span className="source-type">{e.source_path}</span></td>
              <td><span className="source-type">{e.source_type}</span></td>
              <td><span className="source-type">{e.binary_path}</span></td>
              <td><span className="source-type">{e.binary_type}</span></td>
            </tr>
          ))}
          {executables.length === 0 && (
            <tr><td colSpan={4} style={{ color: '#888' }}>No executables</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
