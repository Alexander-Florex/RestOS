// ──────────────────────────────────────────────
// useInventory.ts — Lista de inventario + sync por socket
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { inventoryApi, type InventoryItem } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';

interface UseInventoryResult {
  items: InventoryItem[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useInventory(): UseInventoryResult {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const { items } = await inventoryApi.list();
      setItems(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el inventario');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const socket = getSocket();

    const onChanged = (updated: InventoryItem) => {
      setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)));
    };
    const onCreated = (created: InventoryItem) => {
      setItems(prev => prev.some(i => i.id === created.id) ? prev : [...prev, created]);
    };
    const onDeleted = (payload: { id: number }) => {
      setItems(prev => prev.filter(i => i.id !== payload.id));
    };

    socket.on(SocketEvents.INVENTORY_ITEM_CHANGED, onChanged);
    socket.on(SocketEvents.INVENTORY_ITEM_CREATED, onCreated);
    socket.on(SocketEvents.INVENTORY_ITEM_DELETED, onDeleted);

    return () => {
      socket.off(SocketEvents.INVENTORY_ITEM_CHANGED, onChanged);
      socket.off(SocketEvents.INVENTORY_ITEM_CREATED, onCreated);
      socket.off(SocketEvents.INVENTORY_ITEM_DELETED, onDeleted);
    };
  }, []);

  return { items, loading, error, refresh };
}
