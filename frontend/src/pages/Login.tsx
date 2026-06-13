import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth } from '../api/client';
import { useAuth } from '../App';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await auth.login(username, password);
      setUser({ id: user.id, username: user.username, mustChangePassword: user.mustChangePassword });
      navigate('/');
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <h2>Login to Lite Polygon</h2>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>Username:</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
        </div>
        <div className="form-row">
          <label>Password:</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        <div className="form-actions flex">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
          <Link to="/register">Register</Link>
        </div>
      </form>
      <p style={{ marginTop: 12, fontSize: 11, color: '#888' }}>
        Default: admin / admin (please change password after login)
      </p>
    </div>
  );
}
