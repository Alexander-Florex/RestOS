// ──────────────────────────────────────────────
// AuthContext.tsx — Estado global de autenticación
// ──────────────────────────────────────────────
import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  authApi, tokenStorage, restaurantIdStorage, type AuthUser, ApiError, SESSION_EXPIRED_EVENT,
} from '../lib/api';
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

const REFRESH_EVERY_MS = 30 * 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const lastRefresh = useRef(0);
  const userRef = useRef<AuthUser | null>(null);
  userRef.current = user;

  // Al montar: si hay token guardado, intenta restaurar la sesión
  useEffect(() => {
    const token = tokenStorage.get();
    if (!token) {
      setLoading(false);
      return;
    }

    // refresh valida la sesión (como /me) y además entrega un token nuevo
    authApi.refresh()
      .then(({ user, token }) => {
        tokenStorage.set(token);
        lastRefresh.current = Date.now();
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

  // El token dura poco (12 h): mientras la app está abierta se renueva cada 30 min,
  // y al volver a la pestaña o despertar el celular si pasó ese tiempo.
  useEffect(() => {
    if (!userId) return;
    const renew = () => {
      if (Date.now() - lastRefresh.current < REFRESH_EVERY_MS) return;
      lastRefresh.current = Date.now();
      authApi.refresh()
        .then(({ token }) => tokenStorage.set(token))
        .catch(() => { /* sin red: se reintenta en la próxima vuelta; un 401 lo maneja SESSION_EXPIRED */ });
    };
    const timer = window.setInterval(renew, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') renew(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);

  // El servidor rechazó la sesión (venció, usuario desactivado o borrado): volver al login
  useEffect(() => {
    const onExpired = () => {
      disconnectSocket();
      if (userRef.current) toast.error('Tu sesión terminó. Iniciá sesión de nuevo.');
      setUser(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (restaurantId: number, username: string, password: string) => {
    try {
      const { user, token } = await authApi.login(restaurantId, username, password);
      tokenStorage.set(token);
      lastRefresh.current = Date.now();
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
