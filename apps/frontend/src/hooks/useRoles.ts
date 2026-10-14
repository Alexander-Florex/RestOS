// ──────────────────────────────────────────────
// useRoles.ts — Roles del restaurante y catálogo de permisos
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { rolesApi, type AppRole, type PermissionInfo } from '../lib/api';

interface UseRolesResult {
  roles: AppRole[];
  catalog: PermissionInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRoles(): UseRolesResult {
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [catalog, setCatalog] = useState<PermissionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [{ roles }, { permissions }] = await Promise.all([rolesApi.list(), rolesApi.permissions()]);
      setRoles(roles);
      setCatalog(permissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los roles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { roles, catalog, loading, error, refresh };
}
