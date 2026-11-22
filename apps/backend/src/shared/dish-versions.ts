// ──────────────────────────────────────────────
// dish-versions.ts — Entrada y versión grande de un plato al tomar el pedido
//
// Son dos platos de la carta, cada uno con su precio, categoría y receta. El mozo
// ve uno solo y elige la versión. Si una de las dos no se puede pedir, se muestra
// la otra como un plato común. Sin dependencias: lo usan backend y frontend.
// ──────────────────────────────────────────────
export interface VersionedDish {
  id: number;
  name: string;
  category: string;
  enabled: boolean;
  stock: string;
  largeVersionId?: number | null;
}

const orderable = (d: VersionedDish) => d.enabled && d.stock !== 'OUT_OF_STOCK';

/** La versión grande para ofrecer, si este plato y ella se pueden pedir. */
export function largeVersionOf<T extends VersionedDish>(item: T, menu: readonly T[]): T | null {
  if (!item.largeVersionId || !orderable(item)) return null;
  const large = menu.find(m => m.id === item.largeVersionId);
  return large && orderable(large) ? large : null;
}

/** La carta del mozo: la versión grande no se repite si ya se ofrece desde su plato base. */
export function orderMenu<T extends VersionedDish>(menu: readonly T[]): T[] {
  const offered = new Set(menu.flatMap(m => {
    const large = largeVersionOf(m, menu);
    return large ? [large.id] : [];
  }));
  return menu.filter(m => !offered.has(m.id));
}

/** El plato aparece en su categoría y también en la de su versión grande. */
export function inOrderCategory<T extends VersionedDish>(item: T, category: string, menu: readonly T[]): boolean {
  return item.category === category || largeVersionOf(item, menu)?.category === category;
}

/** Nombres por los que se encuentra el plato al buscar. */
export function versionNames<T extends VersionedDish>(item: T, menu: readonly T[]): string[] {
  const large = largeVersionOf(item, menu);
  return large ? [item.name, large.name] : [item.name];
}
