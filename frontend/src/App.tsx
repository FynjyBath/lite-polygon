import React, { useState, useEffect, createContext, useContext } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { auth } from './api/client';
import TopBar from './components/TopBar';
import ScrollMemory from './components/ScrollMemory';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import ProblemsPage from './pages/Problems';
import ProblemPage from './pages/Problem';
import ContestsPage from './pages/Contests';
import ContestPage from './pages/Contest';

interface AuthCtx {
  user: { id: number; username: string; mustChangePassword: boolean } | null;
  setUser: (u: AuthCtx['user']) => void;
  loading: boolean;
}

export const AuthContext = createContext<AuthCtx>({ user: null, setUser: () => {}, loading: true });
export const useAuth = () => useContext(AuthContext);

type Theme = 'light' | 'dark';
interface ThemeCtx { theme: Theme; toggle: () => void; }
export const ThemeContext = createContext<ThemeCtx>({ theme: 'light', toggle: () => {} });
export const useTheme = () => useContext(ThemeContext);

function useThemeState(): ThemeCtx {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) || 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  return { theme, toggle: () => setTheme(t => (t === 'light' ? 'dark' : 'light')) };
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 20 }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const [user, setUser] = useState<AuthCtx['user']>(null);
  const [loading, setLoading] = useState(true);
  const themeCtx = useThemeState();

  useEffect(() => {
    auth.me().then(u => {
      setUser({ id: u.id, username: u.username, mustChangePassword: u.mustChangePassword });
    }).catch(() => {
      setUser(null);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <ThemeContext.Provider value={themeCtx}>
    <AuthContext.Provider value={{ user, setUser, loading }}>
      <ScrollMemory />
      <TopBar />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/" element={<RequireAuth><ProblemsPage /></RequireAuth>} />
        <Route path="/problems" element={<RequireAuth><ProblemsPage /></RequireAuth>} />
        <Route path="/problem/:id/*" element={<RequireAuth><ProblemPage /></RequireAuth>} />
        <Route path="/contests" element={<RequireAuth><ContestsPage /></RequireAuth>} />
        <Route path="/contest/:id" element={<RequireAuth><ContestPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthContext.Provider>
    </ThemeContext.Provider>
  );
}
