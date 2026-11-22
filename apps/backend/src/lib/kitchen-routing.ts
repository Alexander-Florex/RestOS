// ──────────────────────────────────────────────
// kitchen-routing.ts — Qué platos salen en la comanda y bajo qué título
//
// La categoría dice si va a cocina (menu_categories.sendToKitchen) y da el título
// del grupo en la comanda. Ante la duda el plato SE IMPRIME: es peor que cocina no
// se entere a que le llegue algo de más.
// ──────────────────────────────────────────────
import { prisma } from './prisma.js';
import { logger } from './logger.js';

const DRINK_CATEGORIES = new Set(['bebida', 'bebidas', 'drinks']);
const categoryKey = (name: string) => name.trim().toLowerCase();

export function isDrinkCategoryName(name: string): boolean {
  return DRINK_CATEGORIES.has(categoryKey(name));
}

export interface KitchenRoute {
  goesToKitchen: boolean;
  /** Título del grupo en la comanda: el nombre de la categoría */
  course: string | null;
  /** Posición de la categoría en la carta */
  courseOrder: number;
}

const UNKNOWN: KitchenRoute = { goesToKitchen: true, course: null, courseOrder: Number.MAX_SAFE_INTEGER };

/** Devuelve una función que dice si cada plato va a cocina y bajo qué título. */
export async function kitchenRoutes(
  restaurantId: number,
  menuItemIds: Array<number | null>,
): Promise<(menuItemId: number | null) => KitchenRoute> {
  const ids = [...new Set(menuItemIds.filter((id): id is number => id !== null))];
  if (ids.length === 0) return () => UNKNOWN;
  try {
    const [items, categories] = await Promise.all([
      prisma.menuItem.findMany({
        where: { restaurantId, id: { in: ids } },
        select: { id: true, category: true },
      }),
      prisma.menuCategory.findMany({
        where: { restaurantId },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        select: { name: true, sendToKitchen: true },
      }),
    ]);
    const byName = new Map(categories.map((c, index) => [categoryKey(c.name), { ...c, index }]));
    const routes = new Map<number, KitchenRoute>(items.map((i) => {
      const cat = byName.get(categoryKey(i.category));
      return [i.id, {
        // Platos con una categoría sin fila propia: solo se reconocen las bebidas por nombre
        goesToKitchen: cat?.sendToKitchen ?? !isDrinkCategoryName(i.category),
        course: cat?.name ?? i.category,
        courseOrder: cat?.index ?? categories.length,
      }];
    }));
    return (id) => (id === null ? UNKNOWN : routes.get(id) ?? UNKNOWN);
  } catch (err) {
    logger.error('kitchen_routes_failed', { restaurantId, error: err instanceof Error ? err.message : String(err) });
    return () => UNKNOWN;
  }
}

/** Los platos de la comanda, sin lo que no va a cocina y ordenados como la carta. */
export function kitchenItems<T extends { menuItemId: number | null }>(
  items: T[],
  route: (menuItemId: number | null) => KitchenRoute,
): Array<T & { course: string | null }> {
  return items
    .map(item => ({ item, r: route(item.menuItemId) }))
    .filter(({ r }) => r.goesToKitchen)
    .map((row, index) => ({ ...row, index }))
    .sort((a, b) =>
      a.r.courseOrder - b.r.courseOrder
      || (a.r.course ?? '').localeCompare(b.r.course ?? '')
      || a.index - b.index)
    .map(({ item, r }) => ({ ...item, course: r.course }));
}
