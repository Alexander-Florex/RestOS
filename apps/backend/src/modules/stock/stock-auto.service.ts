// ──────────────────────────────────────────────
// stock-auto.service.ts — Stock automático (fase 3)
//
// 3.4 Al vender, se descuentan los insumos de cada plato según su receta (apagado
//     hasta que el local lo active). Los platos sin receta no descuentan y se listan.
// 3.5 Producción: elaborar N de un elaborado (salsa, pasta) descuenta sus insumos y
//     suma stock del elaborado, con su costo.
// 3.6 Stock mínimo: lista de compras agrupada por proveedor.
// 3.7 Mermas: desperdicio con motivo (movimiento WASTE).
// 3.8 Estado del plato según el stock de sus insumos (si el plato lo pide).
// Vender NUNCA se bloquea por falta de stock: el saldo puede quedar negativo y se ve.
// ──────────────────────────────────────────────
import { StockMovementType, type Prisma, type StockStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { applyMovement, lockItem, lockItems, round4 } from '../../lib/stock.js';
import { batchesFor, explode, loadRecipes, recipeByMenuItem, type Explosion } from '../../lib/recipe-explode.js';
import { convertUnits, UnitError } from '../../shared/units.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';

type Tx = Prisma.TransactionClient;

function emitItems(restaurantId: number, ids: number[]) {
  if (ids.length) ioRestaurant(restaurantId).emit(SocketEvents.INVENTORY_ITEM_CHANGED, { ids });
}

/**
 * Descuenta el stock de una venta, dentro de su transacción. Si el restaurante no lo
 * tiene activado, no hace nada. Devuelve los insumos tocados (para avisar por socket).
 */
export async function deductForSale(
  tx: Tx, restaurantId: number, saleId: number, items: Array<{ menuItemId: number | null; quantity: number }>,
): Promise<number[]> {
  const r = await tx.restaurant.findUnique({ where: { id: restaurantId }, select: { autoStockOnSale: true } });
  if (!r?.autoStockOnSale) return [];
  const recipes = await loadRecipes(tx, restaurantId);
  const byMenu = recipeByMenuItem(recipes);
  const out: Explosion = { needs: new Map(), warnings: [] };
  for (const it of items) {
    const recipe = it.menuItemId !== null ? byMenu.get(it.menuItemId) : undefined;
    if (!recipe) continue; // sin receta: no descuenta (aparece en el informe)
    if (recipe.stockItem) {
      // Plato que se prepara antes y tiene stock propio (ej. porciones de lasagna)
      try { out.needs.set(recipe.stockItem.id, (out.needs.get(recipe.stockItem.id) ?? 0) + convertUnits(it.quantity, 'un', recipe.stockItem.unit)); }
      catch { explode(recipes, recipe.id, it.quantity / (recipe.yield > 0 ? recipe.yield : 1), out); }
      continue;
    }
    explode(recipes, recipe.id, it.quantity / (recipe.yield > 0 ? recipe.yield : 1), out);
  }
  if (out.needs.size === 0) return [];
  const locked = await lockItems(tx, restaurantId, [...out.needs.keys()]);
  for (const [id, need] of out.needs) {
    const item = locked.get(id);
    if (!item || need <= 0) continue;
    await applyMovement(tx, item, { type: StockMovementType.SALE, delta: -need, reference: `Venta #${saleId}` });
  }
  return [...locked.keys()];
}

export const stockAutoService = {
  async settings(restaurantId: number) {
    const r = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { autoStockOnSale: true } });
    return { autoStockOnSale: r.autoStockOnSale };
  },

  async setSettings(restaurantId: number, data: { autoStockOnSale: boolean }) {
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { autoStockOnSale: data.autoStockOnSale } });
    return stockAutoService.settings(restaurantId);
  },

  /** Producción (3.5): elaborar `quantity` del elaborado de la receta (en la unidad de su insumo). */
  async produce(restaurantId: number, recipeId: number, quantity: number) {
    if (!Number.isFinite(quantity) || quantity <= 0) throw HttpError.badRequest('La cantidad tiene que ser mayor a cero');
    const result = await prisma.$transaction(async (tx) => {
      const recipes = await loadRecipes(tx, restaurantId);
      const recipe = recipes.get(recipeId);
      if (!recipe) throw HttpError.notFound('Receta no encontrada');
      if (!recipe.stockItem) throw HttpError.badRequest(`"${recipe.name}" no tiene un insumo de stock: elegí cuál produce en la receta`);
      let batches: number;
      try { batches = batchesFor(recipe, quantity); }
      catch (err) { throw HttpError.badRequest(err instanceof UnitError ? err.message : 'No se pudo calcular la tanda'); }
      const out: Explosion = { needs: new Map(), warnings: [] };
      explode(recipes, recipe.id, batches, out, 0, true);
      out.needs.delete(recipe.stockItem.id); // no se consume a sí mismo
      const locked = await lockItems(tx, restaurantId, [...out.needs.keys(), recipe.stockItem.id]);
      let costCents = 0;
      const ref = `Producción: ${recipe.name}`;
      for (const [id, need] of out.needs) {
        const item = locked.get(id);
        if (!item || need <= 0) continue;
        costCents += Math.round(need * Number(item.costPerUnit) * 100);
        await applyMovement(tx, item, { type: StockMovementType.PRODUCTION, delta: -need, reference: ref });
      }
      const output = locked.get(recipe.stockItem.id)!;
      const unitCost = round4(costCents / 100 / quantity);
      await applyMovement(tx, output, { type: StockMovementType.PRODUCTION, delta: quantity, reference: ref, unitCost });
      // El elaborado queda con el costo de lo que se usó para hacerlo
      if (unitCost > 0) await tx.inventoryItem.update({ where: { id: output.id }, data: { costPerUnit: unitCost } });
      return { touched: [...locked.keys()], warnings: out.warnings, cost: costCents / 100, unitCost, item: output.name, unit: output.unit, quantity };
    });
    emitItems(restaurantId, result.touched);
    return { item: result.item, quantity: result.quantity, unit: result.unit, cost: result.cost, unitCost: result.unitCost, warnings: result.warnings };
  },

  /** Merma (3.7): desperdicio con motivo. */
  async waste(restaurantId: number, itemId: number, quantity: number, reason: string) {
    if (!Number.isFinite(quantity) || quantity <= 0) throw HttpError.badRequest('La cantidad tiene que ser mayor a cero');
    const why = reason.trim();
    if (why.length < 3) throw HttpError.badRequest('Escribí el motivo (vencido, se rompió, error de cocina…)');
    const balance = await prisma.$transaction(async (tx) => {
      const item = await lockItem(tx, restaurantId, itemId);
      if (!item) throw HttpError.notFound('Insumo no encontrado');
      return applyMovement(tx, item, { type: StockMovementType.WASTE, delta: -quantity, reason: why.slice(0, 500) });
    });
    emitItems(restaurantId, [itemId]);
    return { balance };
  },

  /** Lista de compras (3.6): lo que está por debajo del mínimo, agrupado por proveedor. */
  async shoppingList(restaurantId: number) {
    const items = await prisma.inventoryItem.findMany({
      where: { restaurantId, minStock: { gt: 0 } },
      include: { supplierRef: true },
      orderBy: { name: 'asc' },
    });
    const low = items.filter(i => i.quantity < i.minStock);
    const groups = new Map<string, { supplier: { id: number; name: string; phone: string | null } | null; items: unknown[] }>();
    for (const i of low) {
      // Reponer hasta el doble del mínimo; en presentaciones de compra si las tiene
      const missing = round4(i.minStock * 2 - i.quantity);
      let presentations: number | null = null;
      if (i.purchaseQty && i.purchaseUnit) {
        try {
          const perPresentation = convertUnits(i.purchaseQty, i.purchaseUnit, i.unit, {
            itemUnit: i.unit, eq: i.equivalenceQty && i.equivalenceUnit ? { qty: i.equivalenceQty, unit: i.equivalenceUnit } : null,
          });
          if (perPresentation > 0) presentations = Math.ceil(missing / perPresentation);
        } catch { /* presentación con otra unidad: se sugiere en la unidad del insumo */ }
      }
      const key = i.supplierRef ? `s${i.supplierRef.id}` : 'none';
      const g = groups.get(key) ?? { supplier: i.supplierRef ? { id: i.supplierRef.id, name: i.supplierRef.name, phone: i.supplierRef.phone } : null, items: [] };
      g.items.push({
        id: i.id, name: i.name, unit: i.unit, quantity: i.quantity, minStock: i.minStock, suggested: missing,
        presentations, purchaseLabel: i.purchaseQty && i.purchaseUnit ? `${i.purchaseQty} ${i.purchaseUnit}` : null,
        estimatedCost: Math.round(missing * Number(i.costPerUnit) * 100) / 100,
      });
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => (a.supplier?.name ?? 'zzz').localeCompare(b.supplier?.name ?? 'zzz'));
  },

  /** Platos vendidos sin receta en el rango (no descuentan stock). */
  async unrecipedSales(restaurantId: number, from: Date, to: Date) {
    const recipes = await prisma.recipe.findMany({ where: { restaurantId, menuItemId: { not: null } }, select: { menuItemId: true } });
    const withRecipe = new Set(recipes.map(r => r.menuItemId));
    const rows = await prisma.saleItem.groupBy({
      by: ['menuItemId', 'itemName'],
      where: { sale: { restaurantId, closedAt: { gte: from, lte: to } } },
      _sum: { quantity: true },
    });
    return rows
      .filter(r => r.menuItemId === null || !withRecipe.has(r.menuItemId))
      .map(r => ({ menuItemId: r.menuItemId, name: r.itemName, quantity: r._sum.quantity ?? 0 }))
      .sort((a, b) => b.quantity - a.quantity);
  },

  /**
   * Estado de stock de los platos que lo toman de sus insumos (3.8):
   * agotado si no alcanza para una porción; poco si alcanza para menos de 5 o algún insumo está bajo el mínimo.
   */
  async menuStock(restaurantId: number, menuItemIds?: number[]): Promise<Map<number, { status: StockStatus; portions: number | null }>> {
    const menu = await prisma.menuItem.findMany({
      where: { restaurantId, stockAuto: true, ...(menuItemIds ? { id: { in: menuItemIds } } : {}) },
      select: { id: true },
    });
    const result = new Map<number, { status: StockStatus; portions: number | null }>();
    if (menu.length === 0) return result;
    const [recipes, items] = await Promise.all([
      loadRecipes(prisma as unknown as Tx, restaurantId),
      prisma.inventoryItem.findMany({ where: { restaurantId }, select: { id: true, quantity: true, minStock: true } }),
    ]);
    const stock = new Map(items.map(i => [i.id, i]));
    const byMenu = recipeByMenuItem(recipes);
    for (const m of menu) {
      const recipe = byMenu.get(m.id);
      if (!recipe) continue; // sin receta: queda el estado manual
      const out: Explosion = { needs: new Map(), warnings: [] };
      if (recipe.stockItem) {
        try { out.needs.set(recipe.stockItem.id, convertUnits(1, 'un', recipe.stockItem.unit)); } catch { explode(recipes, recipe.id, 1 / (recipe.yield || 1), out); }
      } else {
        explode(recipes, recipe.id, 1 / (recipe.yield || 1), out);
      }
      let portions = Infinity;
      let belowMin = false;
      for (const [id, need] of out.needs) {
        const s = stock.get(id);
        if (!s || need <= 0) continue;
        portions = Math.min(portions, Math.floor(Math.max(0, s.quantity) / need));
        if (s.minStock > 0 && s.quantity < s.minStock) belowMin = true;
      }
      if (portions === Infinity) continue;
      result.set(m.id, {
        portions,
        status: portions < 1 ? 'OUT_OF_STOCK' : (portions < 5 || belowMin) ? 'LOW_STOCK' : 'IN_STOCK',
      });
    }
    return result;
  },
};
