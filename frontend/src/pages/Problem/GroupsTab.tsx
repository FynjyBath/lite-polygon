import React, { useState, useEffect } from 'react';
import { problems, TestGroup, ProblemInfo } from '../../api/client';

interface Props { problemId: number; info: ProblemInfo; }

export default function GroupsTab({ problemId, info }: Props) {
  const [groups, setGroups] = useState<TestGroup[]>([]);
  const [newGroup, setNewGroup] = useState({ name: '', points: '0', pointsPolicy: 'each-test', feedbackPolicy: 'complete', dependencies: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { reload(); }, [problemId]);

  function reload() {
    problems.viewTestGroup(problemId).then(setGroups).catch(e => setError(e.message));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(''); setError('');
    try {
      await problems.saveTestGroup({
        problemId,
        groupName: newGroup.name,
        points: newGroup.points,
        pointsPolicy: newGroup.pointsPolicy,
        feedbackPolicy: newGroup.feedbackPolicy,
        dependencies: newGroup.dependencies,
      });
      setMsg('Group saved');
      setNewGroup({ name: '', points: '0', pointsPolicy: 'each-test', feedbackPolicy: 'complete', dependencies: '' });
      reload();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  async function enableGroups() {
    try {
      await problems.enableGroups({ problemId, enable: 'true' });
      setMsg('Groups enabled');
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  return (
    <div>
      <div className="flex-between" style={{ marginBottom: 8 }}>
        <h2>Test Groups</h2>
        <button className="btn btn-sm" onClick={enableGroups}>Enable Groups</button>
      </div>

      {msg && <div className="alert alert-success">{msg}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <table className="poly-table" style={{ marginBottom: 12 }}>
        <thead>
          <tr><th>Name</th><th>Points</th><th>Points Policy</th><th>Feedback Policy</th><th>Dependencies</th></tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.id}>
              <td><strong>{g.name}</strong></td>
              <td>{g.points}</td>
              <td>{g.points_policy}</td>
              <td>{g.feedback_policy}</td>
              <td>{g.dependencies.join(', ') || '—'}</td>
            </tr>
          ))}
          {groups.length === 0 && <tr><td colSpan={5} style={{ color: '#888' }}>No groups</td></tr>}
        </tbody>
      </table>

      <div className="section-header">Add/Edit Group</div>
      <form onSubmit={handleSave}>
        <div className="form-row">
          <label>Group name:</label>
          <input type="text" value={newGroup.name} onChange={e => setNewGroup({ ...newGroup, name: e.target.value })}
            required style={{ width: 80 }} />
        </div>
        <div className="form-row">
          <label>Points:</label>
          <input type="number" value={newGroup.points} onChange={e => setNewGroup({ ...newGroup, points: e.target.value })} style={{ width: 80 }} />
        </div>
        <div className="form-row">
          <label>Points policy:</label>
          <select value={newGroup.pointsPolicy} onChange={e => setNewGroup({ ...newGroup, pointsPolicy: e.target.value })}>
            <option value="each-test">each-test</option>
            <option value="complete-group">complete-group</option>
          </select>
        </div>
        <div className="form-row">
          <label>Feedback policy:</label>
          <select value={newGroup.feedbackPolicy} onChange={e => setNewGroup({ ...newGroup, feedbackPolicy: e.target.value })}>
            <option value="complete">complete</option>
            <option value="icpc">icpc</option>
            <option value="points">points</option>
            <option value="none">none</option>
          </select>
        </div>
        <div className="form-row">
          <label>Dependencies (comma):</label>
          <input type="text" value={newGroup.dependencies} onChange={e => setNewGroup({ ...newGroup, dependencies: e.target.value })}
            placeholder="0,1" style={{ width: 120 }} />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary">Save Group</button>
        </div>
      </form>
    </div>
  );
}
