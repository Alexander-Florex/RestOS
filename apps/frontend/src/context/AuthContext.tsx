// ──────────────────────────────────────────────
// AuthContext.tsx — Estado global de autenticación
// ──────────────────────────────────────────────
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { authApi, tokenStorage, restaurantIdStorage, type AuthUser, ApiError } from '../lib/api';
import { connectSocket, disconnectSocket, getSocket, SocketEvents } from '../lib/socket';
import { can as canUser, type Permission } from '../lib/permissions';

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (restaurantId: number, username: string, password: string) => Promise<void>;
  logout: () => void;
  /** true si el usuario logueado tiene alguno de los permisos. */
  can: (...perms: Permission[]) => boolean;
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

  // Si el administrador cambia el rol o desactiva al usuario conectado, refrescar sus permisos
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    const onChanged = (changed: { id: number }) => {
      if (changed.id !== userId) return;
      authApi.me()
        .then(({ user }) => setUser(user))
        .catch(() => { tokenStorage.clear(); disconnectSocket(); setUser(null); });
    };
    socket.on(SocketEvents.USER_CHANGED, onChanged);
    return () => { socket.off(SocketEvents.USER_CHANGED, onChanged); };
  }, [userId]);

  const login = useCallback(async (restaurantId: number, username: string, password: string) => {
    try {
      const { user, token } = await authApi.login(restaurantId, username, password);
      tokenStorage.set(token);
      restaurantIdStorage.set(restaurantId);
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

  const can = useCallback((...perms: Permission[]) => canUser(user, ...perms), [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
