import React, { useState, useEffect } from 'react';
import { problems } from '../../api/client';

interface Props { problemId: number; }

export default function ReviewTab({ problemId }: Props) {
  const [cautions, setCautions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    problems.cautions(problemId).then(data => {
      setCautions(data.cautions);
    }).catch(e => {
      setCautions([e.message]);
    }).finally(() => setLoading(false));
  }, [problemId]);

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <h2>Review / Cautions</h2>
        <button className="btn btn-sm" onClick={() => {
          setLoading(true);
          problems.cautions(problemId).then(data => setCautions(data.cautions)).finally(() => setLoading(false));
        }}>Refresh</button>
      </div>

      {loading ? (
        <div>Checking...</div>
      ) : cautions.length === 0 ? (
        <div className="alert alert-success">
          ✓ No issues detected. Problem appears ready for packaging.
        </div>
      ) : (
        <div>
          <div className="cautions">
            <strong>Issues found ({cautions.length}):</strong>
            <ul>
              {cautions.map((c, i) => (
                <li key={i} style={{ marginTop: 4 }}>{c}</li>
              ))}
            </ul>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            Note: AI tips are not available in this local instance.
          </p>
        </div>
      )}
    </div>
  );
}
