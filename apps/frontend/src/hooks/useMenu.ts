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
        if (!exists) return prev;
        // Si filtramos por onlyEnabled y dejó de estarlo, lo removemos
        if (onlyEnabled && !updated.enabled) {
          return prev.filter(i => i.id !== updated.id);
        }
        return prev.map(i => (i.id === updated.id ? updated : i));
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
