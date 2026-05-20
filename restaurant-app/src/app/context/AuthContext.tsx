import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { AuthUser } from '../lib/auth';
import { saveUser, loadUser, clearUser } from '../lib/auth';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface AuthContextValue {
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadUser);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Error de red' }));
      throw new Error(err.error || 'Credenciales incorrectas');
    }
    const { user: authUser } = await res.json();
    saveUser(authUser);
    setUser(authUser);
  }, []);

  const logout = useCallback(() => {
    clearUser();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
