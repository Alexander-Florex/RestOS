// ──────────────────────────────────────────────
// useStaff.ts — Lista de personal + sync por socket
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { staffApi, type StaffMember } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';

interface UseStaffResult {
  members: StaffMember[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useStaff(): UseStaffResult {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const { members } = await staffApi.list();
      setMembers(members);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el personal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const socket = getSocket();

    const onChanged = (updated: StaffMember) => {
      setMembers(prev => prev.map(m => (m.id === updated.id ? updated : m)));
    };
    const onCreated = (created: StaffMember) => {
      setMembers(prev => prev.some(m => m.id === created.id) ? prev : [...prev, created]);
    };
    const onDeleted = (payload: { id: number }) => {
      setMembers(prev => prev.filter(m => m.id !== payload.id));
    };

    socket.on(SocketEvents.STAFF_CHANGED, onChanged);
    socket.on(SocketEvents.STAFF_CREATED, onCreated);
    socket.on(SocketEvents.STAFF_DELETED, onDeleted);

    return () => {
      socket.off(SocketEvents.STAFF_CHANGED, onChanged);
      socket.off(SocketEvents.STAFF_CREATED, onCreated);
      socket.off(SocketEvents.STAFF_DELETED, onDeleted);
    };
  }, []);

  return { members, loading, error, refresh };
}
