import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { auth } from '../api/client';

export default function TopBar() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await auth.logout();
    setUser(null);
    navigate('/login');
  }

  return (
    <div className="top-bar">
      <Link to="/" className="logo" style={{ color: '#fff', textDecoration: 'none' }}>
        Lite Polygon
      </Link>
      {user && (
        <>
          <Link to="/" style={{ color: '#aad4ff', fontSize: 12 }}>Problems</Link>
          <div className="user-info">
            <span style={{ marginRight: 8 }}>{user.username}</span>
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
  );
}
