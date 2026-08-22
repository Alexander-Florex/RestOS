// ──────────────────────────────────────────────
// useRecipes.ts — Lista de recetas y costos
// Sin sync por socket: es data de costos interna, se refresca on-demand.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { recipesApi, type Recipe } from '../lib/api';

interface UseRecipesResult {
  recipes: Recipe[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useRecipes(): UseRecipesResult {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const { recipes } = await recipesApi.list();
      setRecipes(recipes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las recetas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { recipes, loading, error, refresh };
}
