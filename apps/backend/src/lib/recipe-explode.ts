// ──────────────────────────────────────────────
// recipe-explode.ts — Qué insumos usa un plato o una elaboración (fase 3)
//
// "Desarma" una receta en cantidades de cada insumo, en la unidad del insumo,
// con merma (cantidad bruta) y sub-recetas en cascada. Usa las mismas reglas que
// el costeo (recipes.service): porción = rinde/yield; si no, por rendimiento en unidades.
// Una sub-receta que es un elaborado con stock propio (stockItemId) se descuenta
// de ese stock y no de sus ingredientes (ya se descontaron al producirla).
// ──────────────────────────────────────────────
import type { Prisma } from '@prisma/client';
import { convertUnits, normalizeUnit, unitFamily, UnitError } from '../shared/units.js';
import { isPortionUnit } from '../modules/recipes/recipes.service.js';

type Db = Prisma.TransactionClient;

export interface ExplodeItem {
  id: number; name: string; unit: string; wastePct: number;
  equivalenceQty: number | null; equivalenceUnit: string | null;
}
export interface ExplodeRecipe {
  id: number; name: string; yield: number; yieldQty: number | null; yieldUnit: string | null;
  menuItemId: number | null; stockItemId: number | null; stockItem: ExplodeItem | null;
  ingredients: Array<{
    inventoryItemId: number | null; inventoryItem: ExplodeItem | null;
    subRecipeId: number | null; quantity: number; unit: string; wastePct: number | null;
  }>;
}

export interface Explosion {
  /** inventoryItemId → cantidad (en la unidad del insumo) */
  needs: Map<number, number>;
  /** Líneas que no se pudieron convertir (no se descuentan; se avisa) */
  warnings: string[];
}

const MAX_DEPTH = 20;
const itemSelect = { id: true, name: true, unit: true, wastePct: true, equivalenceQty: true, equivalenceUnit: true } as const;

/** Carga todas las recetas del restaurante con lo necesario para desarmarlas. */
export async function loadRecipes(db: Db, restaurantId: number): Promise<Map<number, ExplodeRecipe>> {
  const rows = await db.recipe.findMany({
    where: { restaurantId },
    select: {
      id: true, name: true, yield: true, yieldQty: true, yieldUnit: true, menuItemId: true, stockItemId: true,
      stockItem: { select: itemSelect },
      ingredients: { select: { inventoryItemId: true, inventoryItem: { select: itemSelect }, subRecipeId: true, quantity: true, unit: true, wastePct: true } },
    },
  });
  return new Map(rows.map(r => [r.id, r]));
}

/** Pasa una cantidad a la unidad del insumo (con su equivalencia, ej. 1 un = 60 g). */
function toItemUnit(qty: number, unit: string, item: ExplodeItem): number {
  // "porción" contra un elaborado que se cuenta por unidades: 1 porción = 1 unidad
  if (isPortionUnit(unit)) {
    const u = normalizeUnit(item.unit);
    if (u && unitFamily(u) === 'count') return convertUnits(qty, 'un', item.unit);
    throw new UnitError(`"${item.name}" se cuenta en ${item.unit}, no en porciones`);
  }
  return convertUnits(qty, unit, item.unit, {
    itemUnit: item.unit,
    eq: item.equivalenceQty && item.equivalenceUnit ? { qty: item.equivalenceQty, unit: item.equivalenceUnit } : null,
  });
}

function add(needs: Map<number, number>, id: number, qty: number) {
  needs.set(id, (needs.get(id) ?? 0) + qty);
}

/**
 * Suma a `out` los insumos de `factor` veces la receta completa (factor 0,25 = un cuarto de la tanda).
 * `useStock`: una sub-receta con stock propio se toma de ese stock (venta y producción la usan así).
 */
export function explode(recipes: Map<number, ExplodeRecipe>, recipeId: number, factor: number, out: Explosion, depth = 0, useStock = true): void {
  const r = recipes.get(recipeId);
  if (!r) { out.warnings.push('Receta inexistente'); return; }
  if (depth > MAX_DEPTH) { out.warnings.push(`"${r.name}" forma un ciclo de sub-recetas`); return; }
  for (const ing of r.ingredients) {
    const gross = (ing.quantity / (1 - (ing.wastePct ?? ing.inventoryItem?.wastePct ?? 0))) * factor;
    if (ing.inventoryItemId !== null && ing.inventoryItem) {
      try { add(out.needs, ing.inventoryItemId, toItemUnit(gross, ing.unit, ing.inventoryItem)); }
      catch (err) { out.warnings.push(`${r.name} → ${ing.inventoryItem.name}: ${err instanceof Error ? err.message : 'no se pudo convertir'}`); }
      continue;
    }
    const sub = ing.subRecipeId !== null ? recipes.get(ing.subRecipeId) : undefined;
    if (!sub) { out.warnings.push(`${r.name}: sub-receta inexistente`); continue; }
    // Elaborado con stock propio: se descuenta de su stock
    if (useStock && sub.stockItem) {
      try { add(out.needs, sub.stockItem.id, toItemUnit(gross, ing.unit, sub.stockItem)); }
      catch (err) { out.warnings.push(`${r.name} → ${sub.name}: ${err instanceof Error ? err.message : 'no se pudo convertir'}`); }
      continue;
    }
    // Si no, se desarma la sub-receta en sus ingredientes
    try {
      const subFactor = isPortionUnit(ing.unit)
        ? gross / (sub.yield > 0 ? sub.yield : 1)
        : sub.yieldQty && sub.yieldUnit
          ? convertUnits(gross, ing.unit, sub.yieldUnit) / sub.yieldQty
          : (() => { throw new UnitError(`"${sub.name}" no tiene rendimiento en unidades`); })();
      explode(recipes, sub.id, subFactor, out, depth + 1, useStock);
    } catch (err) {
      out.warnings.push(`${r.name} → ${sub.name}: ${err instanceof Error ? err.message : 'no se pudo convertir'}`);
    }
  }
}

/** Receta de cada plato del menú (la primera, si hubiera más de una). */
export function recipeByMenuItem(recipes: Map<number, ExplodeRecipe>): Map<number, ExplodeRecipe> {
  const m = new Map<number, ExplodeRecipe>();
  for (const r of [...recipes.values()].sort((a, b) => a.id - b.id)) {
    if (r.menuItemId !== null && !m.has(r.menuItemId)) m.set(r.menuItemId, r);
  }
  return m;
}

/** Cuántas "tandas" de la receta son `qty` del elaborado (en la unidad de su insumo). */
export function batchesFor(r: ExplodeRecipe, qty: number): number {
  if (!r.stockItem) throw new UnitError(`"${r.name}" no produce un insumo con stock`);
  const u = normalizeUnit(r.stockItem.unit);
  // Elaborado que se cuenta (porciones, unidades): cada tanda rinde `yield`
  if (u && unitFamily(u) === 'count' && !r.yieldQty) {
    return convertUnits(qty, r.stockItem.unit, 'un') / (r.yield > 0 ? r.yield : 1);
  }
  if (!r.yieldQty || !r.yieldUnit) throw new UnitError(`"${r.name}" no tiene rendimiento en unidades: cargá cuánto rinde`);
  return convertUnits(qty, r.stockItem.unit, r.yieldUnit) / r.yieldQty;
}
