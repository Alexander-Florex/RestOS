// ──────────────────────────────────────────────
// useDishVersions.ts — Preguntar "entrada o principal" al pedir un plato con versión grande
// ──────────────────────────────────────────────
import { useCallback, useMemo, useState } from 'react';
import { largeVersionOf, orderMenu } from '@shared/dish-versions';
import type { MenuItem } from '../lib/api';

export interface PendingVersion {
  item: MenuItem;
  large: MenuItem;
  onPick: (picked: MenuItem) => void;
}

export function useDishVersions(menu: MenuItem[]) {
  const [pending, setPending] = useState<PendingVersion | null>(null);
  const dishes = useMemo(() => orderMenu(menu), [menu]);
  const largeOf = useCallback((item: MenuItem) => largeVersionOf(item, menu), [menu]);

  /** Sin versión grande sigue directo; con versión grande, primero pregunta cuál. */
  const choose = useCallback((item: MenuItem, onPick: (picked: MenuItem) => void) => {
    const large = largeVersionOf(item, menu);
    if (large) setPending({ item, large, onPick });
    else onPick(item);
  }, [menu]);

  const close = useCallback(() => setPending(null), []);

  return { dishes, largeOf, choose, pending, close };
}
