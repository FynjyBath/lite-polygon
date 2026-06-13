import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useParams, useLocation, useNavigate } from 'react-router-dom';
import { problems, ProblemInfo } from '../api/client';

// Tab pages
import GeneralInfo from './Problem/GeneralInfo';
import StatementTab from './Problem/StatementTab';
import FilesTab from './Problem/FilesTab';
import CheckerTab from './Problem/CheckerTab';
import ValidatorTab from './Problem/ValidatorTab';
import InteractorTab from './Problem/InteractorTab';
import TestsTab from './Problem/TestsTab';
import GroupsTab from './Problem/GroupsTab';
import SolutionsTab from './Problem/SolutionsTab';
import InvocationsTab from './Problem/InvocationsTab';
import StressesTab from './Problem/StressesTab';
import PackagesTab from './Problem/PackagesTab';
import TagsTab from './Problem/TagsTab';
import ReviewTab from './Problem/ReviewTab';

const TABS = [
  { key: 'general', label: 'General Info', path: 'general' },
  { key: 'statement', label: 'Statement', path: 'statement' },
  { key: 'files', label: 'Files', path: 'files' },
  { key: 'checker', label: 'Checker', path: 'checker' },
  { key: 'validator', label: 'Validator', path: 'validator' },
  { key: 'interactor', label: 'Interactor', path: 'interactor' },
  { key: 'tests', label: 'Tests', path: 'tests' },
  { key: 'groups', label: 'Groups', path: 'groups' },
  { key: 'solutions', label: 'Solutions', path: 'solutions' },
  { key: 'invocations', label: 'Invocations', path: 'invocations' },
  { key: 'stresses', label: 'Stresses', path: 'stresses' },
  { key: 'packages', label: 'Packages', path: 'packages' },
  { key: 'tags', label: 'Tags', path: 'tags' },
  { key: 'review', label: 'Review', path: 'review' },
];

export default function ProblemPage() {
  const { id } = useParams<{ id: string }>();
  const problemId = parseInt(id ?? '');
  const [info, setInfo] = useState<ProblemInfo | null>(null);
  const [error, setError] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!problemId) return;
    problems.info(problemId).then(setInfo).catch(e => setError(e.message));
  }, [problemId]);

  function reloadInfo() {
    problems.info(problemId).then(setInfo).catch(() => {});
  }

  const basePath = `/problem/${problemId}`;
  const subPath = location.pathname.replace(basePath, '').replace(/^\//, '');

  if (error) return <div className="content"><div className="alert alert-error">{error}</div></div>;
  if (!info) return <div className="content">Loading...</div>;

  const names = info.names.map(n => n.value).join(', ') || info.shortName;

  return (
    <div>
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #ddd', background: '#f9f9f9' }}>
        <div className="breadcrumb">
          <Link to="/">Problems</Link> &rsaquo; {info.shortName}
          {info.modified ? <span style={{ color: '#c60', marginLeft: 8 }}>[modified]</span> : ''}
        </div>
        <div style={{ fontWeight: 'bold', fontSize: 14 }}>{names}</div>
        <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
          Rev {info.revision} &bull; TL: {info.timeLimit}ms &bull; ML: {Math.round(info.memoryLimit / 1024 / 1024)}MB
          &bull; {info.inputFile || 'stdin'}/{info.outputFile || 'stdout'}
          {info.interactive ? ' &bull; Interactive' : ''}
        </div>
      </div>

      <div className="problem-nav">
        {TABS.map(t => {
          const isActive = t.path === '' ? subPath === '' : subPath === t.path || subPath.startsWith(t.path + '/');
          return (
            <Link
              key={t.key}
              to={`${basePath}${t.path ? '/' + t.path : ''}`}
              className={isActive ? 'active' : ''}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <div className="content clearfix">
        {/* Sidebar summary */}
        <div className="problem-summary">
          <table>
            <tbody>
              <tr><td>Statements:</td><td>{info.statementsCount}</td></tr>
              <tr><td>Tests:</td><td>{info.testsCount}</td></tr>
              <tr><td>Solutions:</td><td>{info.solutionsCount}</td></tr>
              <tr><td>Checker:</td><td>{info.checker ? '✓' : '✗'}</td></tr>
              <tr><td>Validator:</td><td>{info.validator ? '✓' : '✗'}</td></tr>
              <tr><td>Interactor:</td><td>{info.interactor ? '✓' : '✗'}</td></tr>
              <tr><td>Tags:</td><td>{info.tags.join(', ') || '—'}</td></tr>
            </tbody>
          </table>
          <div style={{ marginTop: 8, borderTop: '1px solid #ddd', paddingTop: 6 }}>
            <button
              className="btn btn-sm"
              style={{ width: '100%', marginBottom: 4 }}
              onClick={() => { problems.commitChanges(problemId).then(reloadInfo); }}
            >
              Commit Changes
            </button>
          </div>
        </div>

        <Routes>
          <Route index element={<Navigate to={`/problem/${problemId}/general`} replace />} />
          <Route path="general" element={<GeneralInfo problemId={problemId} info={info} onUpdate={reloadInfo} />} />
          <Route path="statement" element={<StatementTab problemId={problemId} />} />
          <Route path="files" element={<FilesTab problemId={problemId} />} />
          <Route path="checker" element={<CheckerTab problemId={problemId} info={info} onUpdate={reloadInfo} />} />
          <Route path="validator" element={<ValidatorTab problemId={problemId} info={info} onUpdate={reloadInfo} />} />
          <Route path="interactor" element={<InteractorTab problemId={problemId} info={info} onUpdate={reloadInfo} />} />
          <Route path="tests" element={<TestsTab problemId={problemId} info={info} />} />
          <Route path="groups" element={<GroupsTab problemId={problemId} info={info} />} />
          <Route path="solutions" element={<SolutionsTab problemId={problemId} />} />
          <Route path="invocations" element={<InvocationsTab problemId={problemId} />} />
          <Route path="stresses" element={<StressesTab problemId={problemId} />} />
          <Route path="packages" element={<PackagesTab problemId={problemId} info={info} onUpdate={reloadInfo} />} />
          <Route path="tags" element={<TagsTab problemId={problemId} info={info} onUpdate={reloadInfo} />} />
          <Route path="review" element={<ReviewTab problemId={problemId} />} />
        </Routes>
      </div>
    </div>
  );
}
