// ──────────────────────────────────────────────
// useUsers.ts — Lista de usuarios (cuentas de login) + sync por socket
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { usersApi, type AppUser } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';

interface UseUsersResult {
  users: AppUser[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useUsers(): UseUsersResult {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const { users } = await usersApi.list();
      setUsers(users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los usuarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const socket = getSocket();

    const onChanged = (updated: AppUser) => {
      setUsers(prev => prev.map(u => (u.id === updated.id ? updated : u)));
    };
    const onCreated = (created: AppUser) => {
      setUsers(prev => prev.some(u => u.id === created.id) ? prev : [...prev, created]);
    };
    const onDeleted = (payload: { id: number }) => {
      setUsers(prev => prev.filter(u => u.id !== payload.id));
    };

    socket.on(SocketEvents.USER_CHANGED, onChanged);
    socket.on(SocketEvents.USER_CREATED, onCreated);
    socket.on(SocketEvents.USER_DELETED, onDeleted);

    return () => {
      socket.off(SocketEvents.USER_CHANGED, onChanged);
      socket.off(SocketEvents.USER_CREATED, onCreated);
      socket.off(SocketEvents.USER_DELETED, onDeleted);
    };
  }, []);

  return { users, loading, error, refresh };
}
