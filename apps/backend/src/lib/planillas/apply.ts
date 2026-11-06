// ──────────────────────────────────────────────
// planillas/apply.ts — Escribe el plan del importador en la base (tarea 2.9)
//
// Idempotente: lo que ya existe (mismo nombre, sin importar tildes ni
// mayúsculas) no se duplica. Por defecto tampoco se pisa: un insumo existente
// conserva su precio y una receta existente sus líneas (con --update sí se
// actualizan). La cantidad en stock nunca se toca: arranca en 0 y la carga la
// primera toma de inventario (tarea 3.3).
// Usa los mismos servicios que la app: mismas validaciones, historial de
// precios con origen "importación" y una transacción por receta.
// ──────────────────────────────────────────────
import { PriceSource } from '@prisma/client';
import { prisma } from '../prisma.js';
import { inventoryService, type CreateInventoryData } from '../../modules/inventory/inventory.service.js';
import { recipesService, type RecipeIngredientInput } from '../../modules/recipes/recipes.service.js';
import { nameKey } from './normalize.js';
import type { Plan } from './plan.js';

export interface ApplyResult {
  restaurantId: number;
  areasCreated: number;
  itemsCreated: number;
  itemsExisting: number;
  itemsUpdated: number;
  itemsAreaSet: number;
  recipesCreated: number;
  recipesExisting: number;
  recipesUpdated: number;
  recipesFailed: { name: string; error: string }[];
  menuLinked: string[];
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function applyPlan(plan: Plan, restaurantId: number, opts: { update?: boolean } = {}): Promise<ApplyResult> {
  const restaurant = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!restaurant) throw new Error(`No existe el restaurante #${restaurantId}`);
  const result: ApplyResult = {
    restaurantId, areasCreated: 0, itemsCreated: 0, itemsExisting: 0, itemsUpdated: 0, itemsAreaSet: 0,
    recipesCreated: 0, recipesExisting: 0, recipesUpdated: 0, recipesFailed: [], menuLinked: [],
  };

  // Sectores: los que falten, al final y en el orden de la planilla
  const areas = await prisma.storageArea.findMany({ where: { restaurantId } });
  const areaId = new Map(areas.map(a => [nameKey(a.name), a.id]));
  let nextOrder = Math.max(0, ...areas.map(a => a.sortOrder)) + 1;
  for (const name of plan.areas) {
    if (areaId.has(nameKey(name))) continue;
    const a = await prisma.storageArea.create({ data: { restaurantId, name, sortOrder: nextOrder++ } });
    areaId.set(nameKey(name), a.id);
    result.areasCreated++;
  }

  // Insumos
  const existing = await prisma.inventoryItem.findMany({ where: { restaurantId }, select: { id: true, name: true, storageAreaId: true } });
  const byName = new Map(existing.map(i => [nameKey(i.name), i]));
  const itemId = new Map<string, number>();
  for (const it of plan.items) {
    const storageAreaId = it.areaName ? areaId.get(nameKey(it.areaName)) ?? null : null;
    const pricing: Partial<CreateInventoryData> = {
      ...(it.equivalence ? { equivalenceQty: it.equivalence.qty, equivalenceUnit: it.equivalence.unit } : {}),
      ...(it.presentation ? {
        purchaseQty: it.presentation.qty, purchaseUnit: it.presentation.unit, purchasePrice: it.presentation.price,
      } : {}),
    };
    const found = byName.get(nameKey(it.name));
    if (found) {
      itemId.set(it.key, found.id);
      result.itemsExisting++;
      if (found.storageAreaId === null && storageAreaId !== null) {
        await inventoryService.update(restaurantId, found.id, { storageAreaId, countOrder: it.countOrder ?? 0 });
        result.itemsAreaSet++;
      }
      if (opts.update && it.presentation) {
        await inventoryService.update(restaurantId, found.id, pricing, PriceSource.IMPORT);
        result.itemsUpdated++;
      }
      continue;
    }
    const created = await inventoryService.create(restaurantId, {
      name: it.name, category: it.category, quantity: 0, unit: it.unit,
      ...pricing,
      storageAreaId, countOrder: it.countOrder ?? 0,
    }, PriceSource.IMPORT);
    byName.set(nameKey(created.name), { id: created.id, name: created.name, storageAreaId: created.storageAreaId });
    itemId.set(it.key, created.id);
    result.itemsCreated++;
  }

  // Recetas (sub-recetas primero: el plan ya viene ordenado)
  const recipes = await prisma.recipe.findMany({ where: { restaurantId }, select: { id: true, name: true, menuItemId: true } });
  const recipeByName = new Map(recipes.map(r => [nameKey(r.name), r]));
  const linkedMenu = new Set(recipes.map(r => r.menuItemId).filter((x): x is number => x !== null));
  const menuItems = await prisma.menuItem.findMany({ where: { restaurantId }, select: { id: true, name: true } });
  const recipeId = new Map<string, number>();

  const nameBySheet = new Map(plan.recipes.map(r => [r.sheet, r.name]));
  for (const r of plan.recipes) {
    const ingredients: RecipeIngredientInput[] = [];
    // Si una sub-receta no se pudo importar, esta tampoco: se crearía incompleta sin avisar.
    // Arreglada la causa, volver a correr el importador crea las dos.
    const missingSub = r.lines.find(l => l.kind === 'sub' && !recipeId.has(l.sheet));
    if (missingSub && missingSub.kind === 'sub') {
      result.recipesFailed.push({ name: r.name, error: `usa «${nameBySheet.get(missingSub.sheet) ?? missingSub.sheet}», que no se pudo importar` });
      continue;
    }
    for (const l of r.lines) {
      if (l.kind === 'item') {
        const id = itemId.get(l.key);
        if (id) ingredients.push({ inventoryItemId: id, quantity: l.quantity, unit: l.unit });
      } else {
        ingredients.push({ subRecipeId: recipeId.get(l.sheet)!, quantity: l.quantity, unit: l.unit });
      }
    }
    const data = {
      name: r.name, yield: r.yield, yieldQty: r.yieldQty, yieldUnit: r.yieldUnit,
      profitPct: r.profitPct, vatPct: r.vatPct, notes: r.notes, ingredients,
    };
    const found = recipeByName.get(nameKey(r.name));
    try {
      if (found) {
        recipeId.set(r.sheet, found.id);
        if (opts.update) {
          await recipesService.update(restaurantId, found.id, data);
          result.recipesUpdated++;
        } else {
          result.recipesExisting++;
        }
        continue;
      }
      if (ingredients.length === 0) throw new Error('sin líneas válidas');
      // Plato de la carta con el mismo nombre (y sin receta todavía): se vinculan
      const menu = menuItems.find(m => nameKey(m.name) === nameKey(r.name) && !linkedMenu.has(m.id));
      const created = await recipesService.create(restaurantId, { ...data, menuItemId: menu?.id ?? null });
      recipeId.set(r.sheet, created.id);
      recipeByName.set(nameKey(r.name), { id: created.id, name: r.name, menuItemId: menu?.id ?? null });
      if (menu) { linkedMenu.add(menu.id); result.menuLinked.push(`${r.name} → ${menu.name}`); }
      result.recipesCreated++;
    } catch (err) {
      result.recipesFailed.push({ name: r.name, error: errorText(err) });
    }
  }
  return result;
}
