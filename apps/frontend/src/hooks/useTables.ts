// ──────────────────────────────────────────────
// useTables.ts — Hook para listar mesas + sync por socket
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { tablesApi, type Table } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';

interface UseTablesResult {
  tables: Table[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTables(): UseTablesResult {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const { tables } = await tablesApi.list();
      setTables(tables);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las mesas');
    } finally {
      setLoading(false);
    }
  }, []);

  // Carga inicial
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Suscripción a eventos de socket
  useEffect(() => {
    const socket = getSocket();

    const onChanged = (updated: Table) => {
      setTables(prev => prev.map(t => (t.id === updated.id ? updated : t)));
    };
    const onCreated = (created: Table) => {
      setTables(prev => {
        if (prev.some(t => t.id === created.id)) return prev;
        // Insertar manteniendo orden por número
        return [...prev, created].sort((a, b) => a.number - b.number);
      });
    };
    const onDeleted = (payload: { id: number }) => {
      setTables(prev => prev.filter(t => t.id !== payload.id));
    };

    socket.on(SocketEvents.TABLE_CHANGED, onChanged);
    socket.on(SocketEvents.TABLE_CREATED, onCreated);
    socket.on(SocketEvents.TABLE_DELETED, onDeleted);

    return () => {
      socket.off(SocketEvents.TABLE_CHANGED, onChanged);
      socket.off(SocketEvents.TABLE_CREATED, onCreated);
      socket.off(SocketEvents.TABLE_DELETED, onDeleted);
    };
  }, []);

  return { tables, loading, error, refresh };
}

/**
 * Hook secundario: fuerza un re-render cada N ms para actualizar
 * el "tiempo transcurrido" sin pegar contra el servidor.
 */
export function useTick(intervalMs = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
