// ──────────────────────────────────────────────
// recipes.service.ts — Recetas y costos
//
// Costo de elaboración = suma de las líneas. Cada línea es:
// - Un insumo: cantidad neta → bruta según la merma (tarea 2.4:
//   bruta = neta / (1 − merma); la merma es la de la línea o, si no tiene, la
//   del insumo), convertida a la unidad del insumo (tarea 2.1) × costPerUnit.
// - Una sub-receta (tarea 2.3): se costea SIEMPRE por su costo por unidad de
//   rendimiento (costo total / yieldQty, ej. $ por cc de chimichurri) o por
//   porción, nunca por su precio de venta. Se rechazan los ciclos.
// El costo se calcula al leer: si sube un insumo, todas las recetas que lo
// usan (también a través de sub-recetas) quedan actualizadas en cascada.
//
// Precio (tarea 2.6, fórmula del cliente): el margen es SOBRE EL PRECIO.
//   precio sin IVA = costo por porción / (1 − margen)
//   precio con IVA = precio sin IVA × (1 + IVA)
//   costo de mercadería % = 1 − margen
// profitPct de la receta es ese margen objetivo (0–0,95). Los precios de la carta
// se toman CON IVA: el margen real = 1 − costo / (precio de carta / (1 + IVA)).
// ──────────────────────────────────────────────
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { convertUnits, normalizeUnit, UnitError, UNIT_LIST } from '../../shared/units.js';

export interface RecipeIngredientInput {
  /** Un insumo... */
  inventoryItemId?: number | null;
  /** ...o una sub-receta (exactamente uno de los dos) */
  subRecipeId?: number | null;
  /** Cantidad neta (la que va al plato) */
  quantity: number;
  /** Unidad, o "porcion" para una sub-receta usada por porciones */
  unit: string;
  /** Merma de la línea 0–0,95; null/undefined = la del insumo */
  wastePct?: number | null;
}

export interface CreateRecipeData {
  name: string;
  menuItemId?: number | null;
  yield?: number;
  /** Rendimiento en unidades, para usarla como sub-receta (ej. 500 cc) */
  yieldQty?: number | null;
  yieldUnit?: string | null;
  profitPct?: number;
  vatPct?: number;
  notes?: string | null;
  ingredients: RecipeIngredientInput[];
}

export interface UpdateRecipeData extends Partial<CreateRecipeData> {}

export interface RecipeCostLine {
  ingredientId: number;
  kind: 'item' | 'subrecipe';
  inventoryItemId: number | null;
  subRecipeId: number | null;
  name: string;
  /** Cantidad neta cargada */
  quantity: number;
  unit: string;
  /** Merma aplicada (0–0,95) */
  wastePct: number;
  /** Cantidad bruta (con merma) */
  grossQty: number;
  /** Cantidad bruta en la unidad del insumo / del rendimiento de la sub-receta (null si no se pudo) */
  convertedQty: number | null;
  /** Unidad de referencia: la del insumo, la del rendimiento o "porcion" */
  itemUnit: string;
  cost: number | null;
  error: string | null;
}

export interface RecipeCost {
  /** Costo de las líneas que se pudieron calcular */
  costTotal: number;
  lines: RecipeCostLine[];
  /** Líneas que no suman al costo (unidad inconvertible, sub-receta incompleta): el costo está incompleto */
  warnings: string[];
  complete: boolean;
  costPerServing: number;
  /** Costo por unidad de rendimiento (si la receta tiene yieldQty), para usarla como sub-receta */
  costPerYieldUnit: number | null;
  /** Margen objetivo de la receta (sobre el precio sin IVA) */
  margin: number;
  /** Costo de mercadería objetivo = 1 − margen */
  foodCostPct: number;
  /** Precio sugerido sin IVA = costo por porción / (1 − margen) */
  suggestedPriceNet: number | null;
  /** Precio sugerido con IVA (el que iría en la carta) */
  suggestedPrice: number | null;
  /** Precio actual en la carta (con IVA), si la receta está vinculada a un plato */
  menuItemPrice: number | null;
  /** Margen real con el precio de la carta */
  actualMargin: number | null;
  actualFoodCostPct: number | null;
  /** El precio de la carta deja un margen menor al objetivo */
  belowTarget: boolean;
  priceDiff: number | null; // menuItemPrice - suggestedPrice
}

/** Fórmula del cliente (tarea 2.6). Exportada para tests. */
export function pricing(costPerServing: number, margin: number, vatPct: number, menuPriceWithVat: number | null) {
  const valid = margin >= 0 && margin < 1;
  const suggestedPriceNet = valid ? costPerServing / (1 - margin) : null;
  const suggestedPrice = suggestedPriceNet !== null ? suggestedPriceNet * (1 + vatPct) : null;
  const net = menuPriceWithVat !== null && menuPriceWithVat > 0 ? menuPriceWithVat / (1 + vatPct) : null;
  const actualFoodCostPct = net !== null ? costPerServing / net : null;
  const actualMargin = actualFoodCostPct !== null ? 1 - actualFoodCostPct : null;
  return {
    margin,
    foodCostPct: 1 - margin,
    suggestedPriceNet,
    suggestedPrice,
    menuItemPrice: menuPriceWithVat,
    actualMargin,
    actualFoodCostPct,
    // Tolerancia de medio punto para no marcar diferencias de redondeo
    belowTarget: actualMargin !== null && actualMargin < margin - 0.005,
    priceDiff: menuPriceWithVat !== null && suggestedPrice !== null ? menuPriceWithVat - suggestedPrice : null,
  };
}

const PORTION = new Set(['porcion', 'porciones', 'porc', 'porcn']);
/** "porción", "Porciones", "porc." → usa la sub-receta por porciones */
export function isPortionUnit(raw: string): boolean {
  return PORTION.has(raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.\s]/g, ''));
}

const recipeInclude = {
  ingredients: {
    include: { inventoryItem: true, subRecipe: { select: { id: true, name: true } } },
    orderBy: { id: 'asc' },
  },
  menuItem: true,
} satisfies Prisma.RecipeInclude;

type RecipeRow = Prisma.RecipeGetPayload<{ include: typeof recipeInclude }>;

const MAX_DEPTH = 20;

/**
 * Calcula costos de todas las recetas de un restaurante, con memoria: una
 * sub-receta usada en varias recetas se calcula una sola vez.
 */
class CostBook {
  private memo = new Map<number, { costTotal: number; lines: RecipeCostLine[]; warnings: string[] }>();
  private visiting = new Set<number>();

  /** costOverrides: costo por unidad a usar para ciertos insumos (ej. el anterior a una suba) */
  constructor(private recipes: Map<number, RecipeRow>, private costOverrides: Map<number, number> = new Map()) {}

  totals(id: number, depth = 0): { costTotal: number; lines: RecipeCostLine[]; warnings: string[] } {
    const cached = this.memo.get(id);
    if (cached) return cached;
    const recipe = this.recipes.get(id);
    if (!recipe) return { costTotal: 0, lines: [], warnings: ['Sub-receta inexistente'] };
    if (this.visiting.has(id) || depth > MAX_DEPTH) {
      // No debería pasar (se validan al guardar): se avisa en vez de colgarse
      return { costTotal: 0, lines: [], warnings: [`"${recipe.name}" forma un ciclo de sub-recetas`] };
    }
    this.visiting.add(id);
    const lines = recipe.ingredients.map(ing => this.line(ing, depth));
    this.visiting.delete(id);
    const warnings = lines.filter(l => l.error).map(l => `${l.name}: ${l.error}`);
    const result = { costTotal: lines.reduce((s, l) => s + (l.cost ?? 0), 0), lines, warnings };
    this.memo.set(id, result);
    return result;
  }

  private line(ing: RecipeRow['ingredients'][number], depth: number): RecipeCostLine {
    if (ing.subRecipeId !== null) return this.subLine(ing, depth);
    const item = ing.inventoryItem!;
    const wastePct = ing.wastePct ?? item.wastePct ?? 0;
    const grossQty = ing.quantity / (1 - wastePct);
    const base = {
      ingredientId: ing.id, kind: 'item' as const, inventoryItemId: item.id, subRecipeId: null,
      name: item.name, quantity: ing.quantity, unit: ing.unit, wastePct, grossQty, itemUnit: item.unit,
    };
    try {
      const convertedQty = convertUnits(grossQty, ing.unit, item.unit, {
        itemUnit: item.unit,
        eq: item.equivalenceQty && item.equivalenceUnit ? { qty: item.equivalenceQty, unit: item.equivalenceUnit } : null,
      });
      const unitCost = this.costOverrides.get(item.id) ?? Number(item.costPerUnit);
      return { ...base, convertedQty, cost: convertedQty * unitCost, error: null };
    } catch (err) {
      // Datos viejos con una unidad que no se entiende: se avisa, no se inventa un costo
      return { ...base, convertedQty: null, cost: null, error: err instanceof UnitError ? err.message : 'No se pudo convertir' };
    }
  }

  private subLine(ing: RecipeRow['ingredients'][number], depth: number): RecipeCostLine {
    const sub = this.recipes.get(ing.subRecipeId!);
    const wastePct = ing.wastePct ?? 0;
    const grossQty = ing.quantity / (1 - wastePct);
    const base = {
      ingredientId: ing.id, kind: 'subrecipe' as const, inventoryItemId: null, subRecipeId: ing.subRecipeId,
      name: sub?.name ?? 'Sub-receta', quantity: ing.quantity, unit: ing.unit, wastePct, grossQty,
    };
    if (!sub) return { ...base, itemUnit: '', convertedQty: null, cost: null, error: 'La sub-receta no existe' };
    const t = this.totals(sub.id, depth + 1);
    const incomplete = t.warnings.length > 0 ? 'la sub-receta tiene el costo incompleto' : null;

    if (isPortionUnit(ing.unit)) {
      const perPortion = sub.yield > 0 ? t.costTotal / sub.yield : t.costTotal;
      return { ...base, itemUnit: 'porcion', convertedQty: grossQty, cost: grossQty * perPortion, error: incomplete };
    }
    if (!sub.yieldQty || !sub.yieldUnit) {
      return {
        ...base, itemUnit: '', convertedQty: null, cost: null,
        error: `"${sub.name}" no tiene rendimiento en unidades: usala por porción o cargale cuánto rinde`,
      };
    }
    try {
      const convertedQty = convertUnits(grossQty, ing.unit, sub.yieldUnit);
      // Costo por unidad de rendimiento: NUNCA el precio de venta de la sub-receta
      const cost = convertedQty * (t.costTotal / sub.yieldQty);
      return { ...base, itemUnit: sub.yieldUnit, convertedQty, cost, error: incomplete };
    } catch (err) {
      return { ...base, itemUnit: sub.yieldUnit, convertedQty: null, cost: null, error: err instanceof UnitError ? err.message : 'No se pudo convertir' };
    }
  }
}

function costOf(recipe: RecipeRow, book: CostBook): RecipeCost {
  const { costTotal, lines, warnings } = book.totals(recipe.id);
  const costPerServing = recipe.yield > 0 ? costTotal / recipe.yield : costTotal;
  const menuItemPrice = recipe.menuItem ? Number(recipe.menuItem.price) : null;
  const allWarnings = recipe.profitPct >= 1
    ? [...warnings, 'El margen tiene que ser menor a 100 % (se carga sobre el precio, no sobre el costo)']
    : warnings;
  return {
    costTotal,
    lines,
    warnings: allWarnings,
    complete: allWarnings.length === 0,
    costPerServing,
    costPerYieldUnit: recipe.yieldQty ? costTotal / recipe.yieldQty : null,
    ...pricing(costPerServing, recipe.profitPct, recipe.vatPct, menuItemPrice),
  };
}

async function loadBook(restaurantId: number) {
  const rows = await prisma.recipe.findMany({ where: { restaurantId }, include: recipeInclude, orderBy: { name: 'asc' } });
  return { rows, book: new CostBook(new Map(rows.map(r => [r.id, r]))) };
}

async function withCost(restaurantId: number, id: number) {
  const { rows, book } = await loadBook(restaurantId);
  const recipe = rows.find(r => r.id === id);
  if (!recipe) throw HttpError.notFound('Receta no encontrada');
  return { ...recipe, cost: costOf(recipe, book) };
}

function wasteOrFail(waste: number | null | undefined, name: string) {
  if (waste === undefined || waste === null) return null;
  if (!(waste >= 0 && waste <= 0.95)) throw HttpError.badRequest(`"${name}": la merma tiene que estar entre 0 % y 95 %`);
  return waste;
}

function yieldOrFail(qty: number | null | undefined, unit: string | null | undefined) {
  if (qty === undefined && unit === undefined) return undefined;
  if (qty === null || unit === null || unit === '') return { yieldQty: null, yieldUnit: null };
  const u = unit ? normalizeUnit(unit) : null;
  if (!u) throw HttpError.badRequest(`Unidad del rendimiento no reconocida. Usá una de: ${UNIT_LIST.join(', ')}`);
  if (!(qty !== undefined && qty > 0)) throw HttpError.badRequest('El rendimiento tiene que ser mayor a 0');
  return { yieldQty: qty, yieldUnit: u };
}

/**
 * Valida las líneas: cada una es un insumo o una sub-receta del restaurante, con
 * una unidad convertible, sin ciclos. Devuelve las líneas a guardar.
 */
async function validateIngredients(restaurantId: number, recipeId: number | null, ingredients: RecipeIngredientInput[]) {
  if (ingredients.length === 0) throw HttpError.badRequest('La receta debe tener al menos un ingrediente');
  for (const ing of ingredients) {
    if (!!ing.inventoryItemId === !!ing.subRecipeId) {
      throw HttpError.badRequest('Cada ingrediente es un insumo o una sub-receta (uno de los dos)');
    }
  }
  const itemIds = ingredients.map(i => i.inventoryItemId).filter((x): x is number => !!x);
  const subIds = ingredients.map(i => i.subRecipeId).filter((x): x is number => !!x);
  const items = await prisma.inventoryItem.findMany({ where: { id: { in: itemIds }, restaurantId } });
  if (items.length !== new Set(itemIds).size) {
    throw HttpError.badRequest('Alguno de los ingredientes no existe en el inventario de este restaurante');
  }
  if (recipeId !== null && subIds.includes(recipeId)) throw HttpError.badRequest('Una receta no puede usarse a sí misma');
  const subs = await prisma.recipe.findMany({ where: { id: { in: subIds }, restaurantId } });
  if (subs.length !== new Set(subIds).size) throw HttpError.badRequest('Alguna sub-receta no existe en este restaurante');

  if (recipeId !== null && subIds.length > 0) await assertNoCycle(restaurantId, recipeId, subIds);

  const itemById = new Map(items.map(i => [i.id, i]));
  const subById = new Map(subs.map(r => [r.id, r]));
  return ingredients.map((ing) => {
    if (ing.subRecipeId) {
      const sub = subById.get(ing.subRecipeId)!;
      const waste = wasteOrFail(ing.wastePct, sub.name);
      if (isPortionUnit(ing.unit)) return { subRecipeId: sub.id, quantity: ing.quantity, unit: 'porcion', wastePct: waste };
      const unit = normalizeUnit(ing.unit);
      if (!unit) throw HttpError.badRequest(`"${sub.name}": unidad no reconocida "${ing.unit}". Usá "porcion" o una de: ${UNIT_LIST.join(', ')}`);
      if (!sub.yieldQty || !sub.yieldUnit) {
        throw HttpError.badRequest(`"${sub.name}" no tiene rendimiento en unidades: usala por porción o cargale cuánto rinde`);
      }
      try {
        convertUnits(1, unit, sub.yieldUnit);
      } catch (err) {
        throw HttpError.badRequest(`"${sub.name}" (rinde en ${sub.yieldUnit}): ${err instanceof UnitError ? err.message : 'unidad incompatible'}`);
      }
      return { subRecipeId: sub.id, quantity: ing.quantity, unit, wastePct: waste };
    }
    const item = itemById.get(ing.inventoryItemId!)!;
    const waste = wasteOrFail(ing.wastePct, item.name);
    const unit = normalizeUnit(ing.unit);
    if (!unit) throw HttpError.badRequest(`"${item.name}": unidad no reconocida "${ing.unit}". Usá una de: ${UNIT_LIST.join(', ')}`);
    try {
      convertUnits(1, unit, item.unit, {
        itemUnit: item.unit,
        eq: item.equivalenceQty && item.equivalenceUnit ? { qty: item.equivalenceQty, unit: item.equivalenceUnit } : null,
      });
    } catch (err) {
      throw HttpError.badRequest(`"${item.name}" (se maneja en ${item.unit}): ${err instanceof UnitError ? err.message : 'unidad incompatible'}`);
    }
    return { inventoryItemId: item.id, quantity: ing.quantity, unit, wastePct: waste };
  });
}

/** Rechaza que `recipeId` termine usándose a sí misma a través de sus nuevas sub-recetas. */
async function assertNoCycle(restaurantId: number, recipeId: number, newSubIds: number[]) {
  const edges = await prisma.recipeIngredient.findMany({
    where: { recipe: { restaurantId }, subRecipeId: { not: null } },
    select: { recipeId: true, subRecipeId: true },
  });
  const graph = new Map<number, number[]>();
  for (const e of edges) {
    if (e.recipeId === recipeId) continue; // sus líneas se reemplazan por las nuevas
    graph.set(e.recipeId, [...(graph.get(e.recipeId) ?? []), e.subRecipeId!]);
  }
  graph.set(recipeId, newSubIds);
  const names = new Map((await prisma.recipe.findMany({ where: { restaurantId }, select: { id: true, name: true } })).map(r => [r.id, r.name]));

  const path: number[] = [];
  const seen = new Set<number>();
  const dfs = (node: number): boolean => {
    if (node === recipeId && path.length > 0) return true;
    if (seen.has(node)) return false;
    seen.add(node);
    path.push(node);
    for (const next of graph.get(node) ?? []) if (dfs(next)) return true;
    path.pop();
    return false;
  };
  if (dfs(recipeId)) {
    const chain = [...path, recipeId].map(id => names.get(id) ?? `#${id}`).join(' → ');
    throw HttpError.badRequest(`Eso formaría un ciclo de sub-recetas: ${chain}`);
  }
}

/** Margen objetivo de la categoría del plato (por nombre), o null. */
async function categoryTargetMargin(restaurantId: number, menuItemId: number | null): Promise<number | null> {
  if (!menuItemId) return null;
  const item = await prisma.menuItem.findFirst({ where: { id: menuItemId, restaurantId }, select: { category: true } });
  if (!item) return null;
  const cat = await prisma.menuCategory.findFirst({ where: { restaurantId, name: item.category }, select: { targetMargin: true } });
  return cat?.targetMargin ?? null;
}

/** ¿La receta usa el insumo, directo o a través de sub-recetas? */
function usesItem(recipes: Map<number, RecipeRow>, recipeId: number, itemId: number, seen = new Set<number>()): boolean {
  if (seen.has(recipeId)) return false;
  seen.add(recipeId);
  const r = recipes.get(recipeId);
  if (!r) return false;
  return r.ingredients.some(l => l.inventoryItemId === itemId || (l.subRecipeId !== null && usesItem(recipes, l.subRecipeId, itemId, seen)));
}

export interface CostAlertDish {
  menuItemId: number;
  menuItemName: string;
  recipeId: number;
  recipeName: string;
  menuItemPrice: number | null;
  costBefore: number;
  costNow: number;
  previousMargin: number | null;
  currentMargin: number | null;
  targetMargin: number;
  belowTarget: boolean;
  /** Precio con IVA que restablece el margen objetivo */
  suggestedPrice: number | null;
}

export interface CostAlert {
  inventoryItemId: number;
  itemName: string;
  unit: string;
  previousCost: number;
  currentCost: number;
  changePct: number;
  changedAt: string;
  dishes: CostAlertDish[];
  /** Recetas afectadas sin plato en la carta (ej. sub-recetas) */
  otherRecipes: string[];
}

export interface MenuItemCost {
  menuItemId: number;
  recipeId: number;
  recipeName: string;
  costPerServing: number;
  complete: boolean;
  margin: number;
  actualMargin: number | null;
  actualFoodCostPct: number | null;
  belowTarget: boolean;
  suggestedPrice: number | null;
}

export const recipesService = {
  /**
   * Alertas de costos (tarea 2.8): insumos que subieron en los últimos `days`
   * días (según el historial de precios) y qué platos se ven afectados, con su
   * margen anterior y actual y el precio que restablece el margen objetivo.
   */
  async costAlerts(restaurantId: number, days = 30): Promise<CostAlert[]> {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const changes = await prisma.priceHistory.findMany({
      // Pasar de $0 (sin precio) a un precio es cargarlo por primera vez, no una suba
      where: { restaurantId, createdAt: { gte: since }, previousCost: { gt: 0 } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { inventoryItem: { select: { id: true, name: true, unit: true, costPerUnit: true } } },
    });
    // Por insumo: el costo de antes del primer cambio del período contra el actual
    const byItem = new Map<number, { first: (typeof changes)[number]; last: (typeof changes)[number] }>();
    for (const c of changes) {
      const e = byItem.get(c.inventoryItemId);
      byItem.set(c.inventoryItemId, { first: e?.first ?? c, last: c });
    }
    const { rows } = await loadBook(restaurantId);
    const recipes = new Map(rows.map(r => [r.id, r]));
    const now = new CostBook(recipes);

    const alerts: CostAlert[] = [];
    for (const [itemId, { first, last }] of byItem) {
      const previousCost = Number(first.previousCost);
      const currentCost = Number(first.inventoryItem.costPerUnit);
      if (!(currentCost > previousCost)) continue; // solo subas
      const before = new CostBook(recipes, new Map([[itemId, previousCost]]));
      const affected = rows.filter(r => usesItem(recipes, r.id, itemId));
      const dishes = affected.filter(r => r.menuItem).map((r) => {
        const cNow = costOf(r, now);
        const cBefore = costOf(r, before);
        return {
          menuItemId: r.menuItemId!, menuItemName: r.menuItem!.name, recipeId: r.id, recipeName: r.name,
          menuItemPrice: cNow.menuItemPrice,
          costBefore: cBefore.costPerServing, costNow: cNow.costPerServing,
          previousMargin: cBefore.actualMargin, currentMargin: cNow.actualMargin,
          targetMargin: cNow.margin, belowTarget: cNow.belowTarget, suggestedPrice: cNow.suggestedPrice,
        };
      });
      if (affected.length === 0) continue;
      alerts.push({
        inventoryItemId: itemId, itemName: first.inventoryItem.name, unit: first.inventoryItem.unit,
        previousCost, currentCost, changePct: (currentCost - previousCost) / previousCost,
        changedAt: last.createdAt.toISOString(),
        dishes: dishes.sort((a, b) => Number(b.belowTarget) - Number(a.belowTarget)),
        otherRecipes: affected.filter(r => !r.menuItem).map(r => r.name),
      });
    }
    return alerts.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  },

  /**
   * Costo y margen de cada plato de la carta que tiene receta (tarea 2.7). Si un
   * plato tiene más de una receta vinculada, vale la más reciente.
   */
  async menuCosts(restaurantId: number): Promise<MenuItemCost[]> {
    const { rows, book } = await loadBook(restaurantId);
    const byItem = new Map<number, RecipeRow>();
    for (const r of rows) {
      if (r.menuItemId === null) continue;
      const prev = byItem.get(r.menuItemId);
      if (!prev || r.updatedAt > prev.updatedAt) byItem.set(r.menuItemId, r);
    }
    return [...byItem.values()].map((r) => {
      const c = costOf(r, book);
      return {
        menuItemId: r.menuItemId!, recipeId: r.id, recipeName: r.name,
        costPerServing: c.costPerServing, complete: c.complete,
        margin: c.margin, actualMargin: c.actualMargin, actualFoodCostPct: c.actualFoodCostPct,
        belowTarget: c.belowTarget, suggestedPrice: c.suggestedPrice,
      };
    });
  },

  async list(restaurantId: number) {
    const { rows, book } = await loadBook(restaurantId);
    return rows.map(r => ({ ...r, cost: costOf(r, book) }));
  },

  async getById(restaurantId: number, id: number) {
    return withCost(restaurantId, id);
  },

  async create(restaurantId: number, data: CreateRecipeData) {
    if (data.menuItemId) {
      const menuItem = await prisma.menuItem.findFirst({ where: { id: data.menuItemId, restaurantId } });
      if (!menuItem) throw HttpError.badRequest('El ítem del menú indicado no existe');
    }
    const ingredients = await validateIngredients(restaurantId, null, data.ingredients);
    const yieldUnits = yieldOrFail(data.yieldQty, data.yieldUnit);
    // Sin margen indicado: el objetivo de la categoría del plato (o 50 %)
    const margin = data.profitPct ?? (await categoryTargetMargin(restaurantId, data.menuItemId ?? null)) ?? 0.5;

    const recipe = await prisma.recipe.create({
      data: {
        restaurantId,
        name: data.name,
        menuItemId: data.menuItemId ?? null,
        yield: data.yield ?? 1,
        ...(yieldUnits ?? {}),
        profitPct: margin,
        vatPct: data.vatPct ?? 0.21,
        notes: data.notes ?? null,
        ingredients: { create: ingredients },
      },
    });
    return withCost(restaurantId, recipe.id);
  },

  async update(restaurantId: number, id: number, data: UpdateRecipeData) {
    const current = await prisma.recipe.findFirst({
      where: { id, restaurantId },
      include: { usedIn: { include: { recipe: { select: { name: true } } } } },
    });
    if (!current) throw HttpError.notFound('Receta no encontrada');

    if (data.menuItemId) {
      const menuItem = await prisma.menuItem.findFirst({ where: { id: data.menuItemId, restaurantId } });
      if (!menuItem) throw HttpError.badRequest('El ítem del menú indicado no existe');
    }
    const ingredients = data.ingredients ? await validateIngredients(restaurantId, id, data.ingredients) : null;
    const yieldUnits = yieldOrFail(data.yieldQty, data.yieldUnit);

    // Si otras recetas la usan por unidades, el rendimiento tiene que seguir siendo compatible
    if (yieldUnits !== undefined) {
      for (const use of current.usedIn.filter(u => !isPortionUnit(u.unit))) {
        if (!yieldUnits.yieldUnit) {
          throw HttpError.badRequest(`"${use.recipe.name}" la usa en ${use.unit}: no se le puede quitar el rendimiento`);
        }
        try {
          convertUnits(1, use.unit, yieldUnits.yieldUnit);
        } catch {
          throw HttpError.badRequest(`"${use.recipe.name}" la usa en ${use.unit}: el rendimiento tiene que ser compatible`);
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      if (ingredients) await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
      await tx.recipe.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.menuItemId !== undefined ? { menuItemId: data.menuItemId } : {}),
          ...(data.yield !== undefined ? { yield: data.yield } : {}),
          ...(yieldUnits ?? {}),
          ...(data.profitPct !== undefined ? { profitPct: data.profitPct } : {}),
          ...(data.vatPct !== undefined ? { vatPct: data.vatPct } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(ingredients ? { ingredients: { create: ingredients } } : {}),
        },
      });
    });
    return withCost(restaurantId, id);
  },

  async remove(restaurantId: number, id: number): Promise<void> {
    const recipe = await prisma.recipe.findFirst({
      where: { id, restaurantId },
      include: { usedIn: { include: { recipe: { select: { name: true } } } } },
    });
    if (!recipe) throw HttpError.notFound('Receta no encontrada');
    if (recipe.usedIn.length > 0) {
      const names = [...new Set(recipe.usedIn.map(u => u.recipe.name))].join(', ');
      throw HttpError.conflict(`Se usa como sub-receta en: ${names}. Sacala de ahí primero.`);
    }
    await prisma.recipe.delete({ where: { id } });
  },
};
