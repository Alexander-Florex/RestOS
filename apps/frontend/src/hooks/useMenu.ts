// ──────────────────────────────────────────────
// useMenu.ts — Hook para listar y sincronizar el menú
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { menuApi, type MenuItem } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';

interface UseMenuOpts {
  onlyEnabled?: boolean;
}

interface UseMenuResult {
  items: MenuItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMenu(opts: UseMenuOpts = {}): UseMenuResult {
  const { onlyEnabled } = opts;
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const { items } = await menuApi.list({ onlyEnabled });
      setItems(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el menú');
    } finally {
      setLoading(false);
    }
  }, [onlyEnabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const socket = getSocket();

    const onChanged = (updated: MenuItem) => {
      setItems(prev => {
        const exists = prev.some(i => i.id === updated.id);

        // Si filtramos por habilitados y el item pasó a deshabilitado, sacarlo.
        if (onlyEnabled && !updated.enabled) {
          return exists ? prev.filter(i => i.id !== updated.id) : prev;
        }

        // El item debe estar visible: si no estaba (ej. se re-habilitó), agregarlo;
        // si ya estaba, actualizarlo.
        return exists
          ? prev.map(i => (i.id === updated.id ? updated : i))
          : [...prev, updated];
      });
    };
    const onCreated = (created: MenuItem) => {
      if (onlyEnabled && !created.enabled) return;
      setItems(prev => prev.some(i => i.id === created.id) ? prev : [...prev, created]);
    };
    const onDeleted = (payload: { id: number }) => {
      setItems(prev => prev.filter(i => i.id !== payload.id));
    };

    socket.on(SocketEvents.MENU_ITEM_CHANGED, onChanged);
    socket.on(SocketEvents.MENU_ITEM_CREATED, onCreated);
    socket.on(SocketEvents.MENU_ITEM_DELETED, onDeleted);

    return () => {
      socket.off(SocketEvents.MENU_ITEM_CHANGED, onChanged);
      socket.off(SocketEvents.MENU_ITEM_CREATED, onCreated);
      socket.off(SocketEvents.MENU_ITEM_DELETED, onDeleted);
    };
  }, [onlyEnabled]);

  return { items, loading, error, refresh };
}