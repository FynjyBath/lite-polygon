import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, Link, useParams, useLocation } from 'react-router-dom';
import { problems, ProblemInfo } from '../api/client';

// Tab pages
import GeneralInfo from './Problem/GeneralInfo';
import StatementTab from './Problem/StatementTab';
import FilesTab from './Problem/FilesTab';
import CheckerTab from './Problem/CheckerTab';
import ValidatorTab from './Problem/ValidatorTab';
import InteractorTab from './Problem/InteractorTab';
import TestsTab from './Problem/TestsTab';
import SolutionsTab from './Problem/SolutionsTab';
import InvocationsTab from './Problem/InvocationsTab';
import StressesTab from './Problem/StressesTab';
import PackagesTab from './Problem/PackagesTab';
import TagsTab from './Problem/TagsTab';
import ReviewTab from './Problem/ReviewTab';
import PolygonTab from './Problem/PolygonTab';

const TABS = [
  { key: 'general', label: 'General Info', path: 'general' },
  { key: 'statement', label: 'Statement', path: 'statement' },
  { key: 'files', label: 'Files', path: 'files' },
  { key: 'checker', label: 'Checker', path: 'checker' },
  { key: 'validator', label: 'Validator', path: 'validator' },
  { key: 'interactor', label: 'Interactor', path: 'interactor' },
  { key: 'tests', label: 'Tests', path: 'tests' },
  { key: 'solutions', label: 'Solutions', path: 'solutions' },
  { key: 'invocations', label: 'Invocations', path: 'invocations' },
  { key: 'stresses', label: 'Stresses', path: 'stresses' },
  { key: 'packages', label: 'Packages', path: 'packages' },
  { key: 'tags', label: 'Tags', path: 'tags' },
  { key: 'review', label: 'Review', path: 'review' },
  { key: 'polygon', label: 'Polygon', path: 'polygon' },
];

export default function ProblemPage() {
  const { id } = useParams<{ id: string }>();
  const problemId = parseInt(id ?? '');
  const [info, setInfo] = useState<ProblemInfo | null>(null);
  const [error, setError] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitToast, setCommitToast] = useState(false);
  const location = useLocation();

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
      {commitToast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 2000,
          background: '#2a7a2a', color: '#fff', padding: '10px 20px',
          borderRadius: 6, boxShadow: '0 2px 12px rgba(0,0,0,0.25)',
          fontSize: 14, fontWeight: 500,
          animation: 'fadeInUp 0.2s ease',
        }}>
          ✓ Changes committed successfully
        </div>
      )}
      <div className="problem-header" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <div className="breadcrumb">
          <Link to="/">Problems</Link> &rsaquo; {info.shortName}
          {info.modified ? <span style={{ color: '#c60', marginLeft: 8 }}>[modified]</span> : ''}
        </div>
        <div style={{ fontWeight: 'bold', fontSize: 14 }}>{names}</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
          Rev {info.revision} &bull; TL: {info.timeLimit}ms &bull; ML: {Math.round(info.memoryLimit / 1024 / 1024)}MB
          &bull; {info.inputFile || 'stdin'}/{info.outputFile || 'stdout'}
          {info.interactive ? ' • Interactive' : ''}
        </div>
      </div>

      <div className="problem-nav">
        {TABS.map(t => {
          const isActive = subPath === t.path || subPath.startsWith(t.path + '/');
          return (
            <Link
              key={t.key}
              to={`${basePath}/${t.path}`}
              className={isActive ? 'active' : ''}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {/* Two-column layout: main content | sidebar */}
      <div className="content" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* Main area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Routes>
            <Route index element={<Navigate to={`/problem/${problemId}/general`} replace />} />
            <Route path="general" element={<GeneralInfo problemId={problemId} info={info} onUpdate={reloadInfo} />} />
            <Route path="statement" element={<StatementTab problemId={problemId} />} />
            <Route path="files" element={<FilesTab problemId={problemId} />} />
            <Route path="checker" element={<CheckerTab problemId={problemId} info={info} onUpdate={reloadInfo} />} />
            <Route path="validator" element={<ValidatorTab problemId={problemId} info={info} onUpdate={reloadInfo} />} />
            <Route path="interactor" element={<InteractorTab problemId={problemId} info={info} onUpdate={reloadInfo} />} />
            <Route path="tests" element={<TestsTab problemId={problemId} info={info} />} />
            <Route path="solutions" element={<SolutionsTab problemId={problemId} />} />
            <Route path="invocations" element={<InvocationsTab problemId={problemId} testsCount={info.testsCount} solutionsCount={info.solutionsCount} timeLimit={info.timeLimit} />} />
            <Route path="stresses" element={<StressesTab problemId={problemId} />} />
            <Route path="packages" element={<PackagesTab problemId={problemId} info={info} onUpdate={reloadInfo} />} />
            <Route path="tags" element={<TagsTab problemId={problemId} info={info} onUpdate={reloadInfo} />} />
            <Route path="review" element={<ReviewTab problemId={problemId} />} />
            <Route path="polygon" element={<PolygonTab problemId={problemId} info={info} onUpdate={reloadInfo} />} />
          </Routes>
        </div>

        {/* Sidebar */}
        <div className="problem-summary" style={{ flexShrink: 0, width: 200 }}>
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
          <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button
              className="btn btn-sm"
              style={{ width: '100%' }}
              disabled={committing}
              onClick={() => {
                setCommitting(true);
                problems.commitChanges(problemId)
                  .then(() => { reloadInfo(); setCommitToast(true); setTimeout(() => setCommitToast(false), 3000); })
                  .finally(() => setCommitting(false));
              }}
            >
              {committing ? <><span className="spinner" style={{ marginRight: 4 }} />Committing...</> : 'Commit Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
