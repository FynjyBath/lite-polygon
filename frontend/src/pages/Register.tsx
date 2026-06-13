import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { auth } from '../api/client';
import { useAuth } from '../App';

export default function RegisterPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const { setUser } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== password2) { setError('Passwords do not match'); return; }
    try {
      const user = await auth.register(username, password);
      setUser({ id: user.id, username: user.username, mustChangePassword: false });
      navigate('/');
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="login-page">
      <h2>Register</h2>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <label>Username:</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Password:</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Confirm password:</label>
          <input type="password" value={password2} onChange={e => setPassword2(e.target.value)} required />
        </div>
        <div className="form-actions flex">
          <button type="submit" className="btn btn-primary">Register</button>
          <Link to="/login">Login</Link>
        </div>
      </form>
    </div>
  );
}
