// ──────────────────────────────────────────────
// useMenuCategories.ts — Hook para listar categorías del menú + sync socket
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { menuCategoriesApi, type MenuCategory } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';

interface UseMenuCategoriesResult {
  categories: MenuCategory[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMenuCategories(): UseMenuCategoriesResult {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const { categories } = await menuCategoriesApi.list();
      setCategories(categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las categorías');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const socket = getSocket();

    const onChanged = (updated: MenuCategory) => {
      setCategories(prev => prev.map(c => (c.id === updated.id ? updated : c))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)));
    };
    const onCreated = (created: MenuCategory) => {
      setCategories(prev => {
        if (prev.some(c => c.id === created.id)) return prev;
        return [...prev, created].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
      });
    };
    const onDeleted = (payload: { id: number }) => {
      setCategories(prev => prev.filter(c => c.id !== payload.id));
    };

    socket.on(SocketEvents.MENU_CATEGORY_CHANGED, onChanged);
    socket.on(SocketEvents.MENU_CATEGORY_CREATED, onCreated);
    socket.on(SocketEvents.MENU_CATEGORY_DELETED, onDeleted);

    return () => {
      socket.off(SocketEvents.MENU_CATEGORY_CHANGED, onChanged);
      socket.off(SocketEvents.MENU_CATEGORY_CREATED, onCreated);
      socket.off(SocketEvents.MENU_CATEGORY_DELETED, onDeleted);
    };
  }, []);

  return { categories, loading, error, refresh };
}
