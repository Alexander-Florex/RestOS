// ──────────────────────────────────────────────
// useStorageAreas.ts — Sectores de guardado (tarea 3.1) + sync por socket
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { storageAreasApi, type StorageArea } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useResync } from './useConnection';

export function useStorageAreas() {
  const [areas, setAreas] = useState<StorageArea[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { areas } = await storageAreasApi.list();
      setAreas(areas);
    } catch {
      // Sin permiso o sin conexión: se muestra sin sectores
    } finally {
      setLoading(false);
    }
  }, []);

  useResync(refresh);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    const onChanged = () => { refresh(); };
    socket.on(SocketEvents.STORAGE_AREAS_CHANGED, onChanged);
    // La cantidad de insumos por sector cambia al mover o crear insumos
    socket.on(SocketEvents.INVENTORY_ITEM_CREATED, onChanged);
    socket.on(SocketEvents.INVENTORY_ITEM_DELETED, onChanged);
    return () => {
      socket.off(SocketEvents.STORAGE_AREAS_CHANGED, onChanged);
      socket.off(SocketEvents.INVENTORY_ITEM_CREATED, onChanged);
      socket.off(SocketEvents.INVENTORY_ITEM_DELETED, onChanged);
    };
  }, [refresh]);

  return { areas, loading, refresh };
}
