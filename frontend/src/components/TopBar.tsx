import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth, useTheme } from '../App';
import { auth } from '../api/client';

export default function TopBar() {
  const { user, setUser } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  const [showChangePwd, setShowChangePwd] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdError, setPwdError] = useState('');
  const [pwdOk, setPwdOk] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);

  async function handleLogout() {
    await auth.logout();
    setUser(null);
    navigate('/login');
  }

  function openChangePwd() {
    setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
    setPwdError(''); setPwdOk(false);
    setShowChangePwd(true);
  }

  async function handleChangePwd(e: React.FormEvent) {
    e.preventDefault();
    if (newPwd !== confirmPwd) { setPwdError('New passwords do not match'); return; }
    if (newPwd.length < 6) { setPwdError('New password must be at least 6 characters'); return; }
    setPwdLoading(true); setPwdError('');
    try {
      await auth.changePassword(currentPwd, newPwd);
      setPwdOk(true);
      setTimeout(() => setShowChangePwd(false), 1200);
    } catch (e: unknown) {
      setPwdError((e as Error).message);
    } finally {
      setPwdLoading(false);
    }
  }

  return (
    <>
      <div className="top-bar">
        <Link to="/" className="logo" style={{ color: '#fff', textDecoration: 'none' }}>
          Lite Polygon
        </Link>
        {user && (
          <>
            <Link to="/" style={{ color: '#aad4ff', fontSize: 12 }}>Problems</Link>
            <Link to="/contests" style={{ color: '#aad4ff', fontSize: 12 }}>Contests</Link>
            <div className="user-info">
              <button
                onClick={toggle}
                className="btn btn-sm"
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                style={{ fontSize: 13, background: '#444', border: '1px solid #777', color: '#ddd', cursor: 'pointer', marginRight: 8, lineHeight: 1 }}
              >
                {theme === 'dark' ? '☀' : '☾'}
              </button>
              <span style={{ marginRight: 8 }}>{user.username}</span>
              <button
                onClick={openChangePwd}
                className="btn btn-sm"
                style={{ fontSize: 11, background: '#444', border: '1px solid #777', color: '#ddd', cursor: 'pointer', marginRight: 4 }}
              >
                Change Password
              </button>
              <button
                onClick={handleLogout}
                className="btn btn-sm"
                style={{ fontSize: 11, background: '#555', border: '1px solid #888', color: '#fff', cursor: 'pointer' }}
              >
                Logout
              </button>
            </div>
          </>
        )}
      </div>

      {showChangePwd && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setShowChangePwd(false); }}
        >
          <div style={{ background: 'var(--surface)', borderRadius: 6, padding: '24px 28px', minWidth: 320, boxShadow: '0 4px 24px rgba(0,0,0,0.25)' }}>
            <div style={{ fontWeight: 'bold', fontSize: 15, marginBottom: 16 }}>Change Password</div>
            {pwdOk ? (
              <div className="alert alert-success">Password changed successfully!</div>
            ) : (
              <form onSubmit={handleChangePwd}>
                {pwdError && <div className="alert alert-error" style={{ marginBottom: 10 }}>{pwdError}</div>}
                <div className="form-row">
                  <label style={{ width: 140 }}>Current password:</label>
                  <input
                    type="password"
                    value={currentPwd}
                    onChange={e => setCurrentPwd(e.target.value)}
                    required
                    autoFocus
                    style={{ flex: 1 }}
                  />
                </div>
                <div className="form-row">
                  <label style={{ width: 140 }}>New password:</label>
                  <input
                    type="password"
                    value={newPwd}
                    onChange={e => setNewPwd(e.target.value)}
                    required
                    style={{ flex: 1 }}
                  />
                </div>
                <div className="form-row">
                  <label style={{ width: 140 }}>Confirm new password:</label>
                  <input
                    type="password"
                    value={confirmPwd}
                    onChange={e => setConfirmPwd(e.target.value)}
                    required
                    style={{ flex: 1 }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
                  <button type="button" className="btn btn-sm" onClick={() => setShowChangePwd(false)} disabled={pwdLoading}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={pwdLoading}>
                    {pwdLoading ? <><span className="spinner" style={{ marginRight: 4 }} />Saving…</> : 'Change Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
