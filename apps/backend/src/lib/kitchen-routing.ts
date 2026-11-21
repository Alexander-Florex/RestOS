// ──────────────────────────────────────────────
// kitchen-routing.ts — Qué platos salen en la comanda de cocina
//
// Lo decide la categoría del plato (menu_categories.sendToKitchen). Ante la duda
// el plato SE IMPRIME: es peor que cocina no se entere a que le llegue algo de más.
// ──────────────────────────────────────────────
import { prisma } from './prisma.js';
import { logger } from './logger.js';

const DRINK_CATEGORIES = new Set(['bebida', 'bebidas', 'drinks']);
const categoryKey = (name: string) => name.trim().toLowerCase();

export function isDrinkCategoryName(name: string): boolean {
  return DRINK_CATEGORIES.has(categoryKey(name));
}

/** Devuelve una función que dice si un plato de la carta va a cocina. */
export async function kitchenFilter(
  restaurantId: number,
  menuItemIds: Array<number | null>,
): Promise<(menuItemId: number | null) => boolean> {
  const ids = [...new Set(menuItemIds.filter((id): id is number => id !== null))];
  if (ids.length === 0) return () => true;
  try {
    const [items, categories] = await Promise.all([
      prisma.menuItem.findMany({ where: { restaurantId, id: { in: ids } }, select: { id: true, category: true } }),
      prisma.menuCategory.findMany({ where: { restaurantId }, select: { name: true, sendToKitchen: true } }),
    ]);
    const byName = new Map(categories.map(c => [categoryKey(c.name), c.sendToKitchen]));
    const excluded = new Set(
      items
        // Platos con una categoría sin fila propia: solo se reconocen las bebidas por nombre
        .filter(i => !(byName.get(categoryKey(i.category)) ?? !isDrinkCategoryName(i.category)))
        .map(i => i.id),
    );
    return (id) => id === null || !excluded.has(id);
  } catch (err) {
    logger.error('kitchen_filter_failed', { restaurantId, error: err instanceof Error ? err.message : String(err) });
    return () => true;
  }
}
