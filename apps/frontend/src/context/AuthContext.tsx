// ──────────────────────────────────────────────
// AuthContext.tsx — Estado global de autenticación
// ──────────────────────────────────────────────
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { authApi, tokenStorage, type AuthUser, ApiError } from '../lib/api';
import { connectSocket, disconnectSocket } from '../lib/socket';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Al montar: si hay token guardado, intenta restaurar la sesión
  useEffect(() => {
    const token = tokenStorage.get();
    if (!token) {
      setLoading(false);
      return;
    }

    authApi.me()
      .then(({ user }) => {
        setUser(user);
        connectSocket();
      })
      .catch(() => {
        // Token inválido o expirado
        tokenStorage.clear();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const { user, token } = await authApi.login(username, password);
      tokenStorage.set(token);
      setUser(user);
      connectSocket();
    } catch (err) {
      // Re-lanza errores controlados para que el formulario muestre el mensaje
      if (err instanceof ApiError) throw err;
      throw new Error('Error de red. Verificá que el servidor esté corriendo.');
    }
  }, []);

  const logout = useCallback(() => {
    tokenStorage.clear();
    disconnectSocket();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
