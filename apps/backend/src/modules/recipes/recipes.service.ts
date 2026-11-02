// ──────────────────────────────────────────────
// recipes.service.ts — Recetas y costos
//
// Costo de elaboración = suma de (cantidad de cada ingrediente, convertida a la
// unidad del insumo (tarea 2.1), × costPerUnit del InventoryItem). Ej.: 200 g de
// un insumo que cuesta $X por kg = 0,2 × X. Como costPerUnit vive en InventoryItem, el costo de
// toda receta que lo use queda actualizado automáticamente al leer (no se
// desnormaliza ni se cachea).
//
// Precio sugerido = costo por porción × (1 + profitPct) × (1 + vatPct).
// ──────────────────────────────────────────────
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { convertUnits, normalizeUnit, UnitError, UNIT_LIST } from '../../shared/units.js';

export interface RecipeIngredientInput {
  inventoryItemId: number;
  quantity: number;
  unit: string;
}

export interface CreateRecipeData {
  name: string;
  menuItemId?: number | null;
  yield?: number;
  profitPct?: number;
  vatPct?: number;
  notes?: string | null;
  ingredients: RecipeIngredientInput[];
}

export interface UpdateRecipeData extends Partial<CreateRecipeData> {}

export interface RecipeCostLine {
  ingredientId: number;
  inventoryItemId: number;
  name: string;
  quantity: number;
  unit: string;
  /** Cantidad pasada a la unidad del insumo (null si no se pudo convertir) */
  convertedQty: number | null;
  itemUnit: string;
  cost: number | null;
  error: string | null;
}

export interface RecipeCost {
  /** Costo de las líneas que se pudieron calcular */
  costTotal: number;
  lines: RecipeCostLine[];
  /** Líneas que no suman al costo (unidad inconvertible): el costo está incompleto */
  warnings: string[];
  complete: boolean;
  costPerServing: number;
  suggestedPrice: number;
  menuItemPrice: number | null;
  priceDiff: number | null; // menuItemPrice - suggestedPrice
}

const recipeInclude = {
  ingredients: { include: { inventoryItem: true } },
  menuItem: true,
} as const;

type CostInput = {
  yield: number; profitPct: number; vatPct: number; menuItem: { price: unknown } | null;
  ingredients: Array<{
    id: number; quantity: number; unit: string;
    inventoryItem: { id: number; name: string; unit: string; costPerUnit: unknown; equivalenceQty: number | null; equivalenceUnit: string | null };
  }>;
};

export function computeCost(recipe: CostInput): RecipeCost {
  const lines: RecipeCostLine[] = recipe.ingredients.map((ing) => {
    const item = ing.inventoryItem;
    const base = {
      ingredientId: ing.id, inventoryItemId: item.id, name: item.name,
      quantity: ing.quantity, unit: ing.unit, itemUnit: item.unit,
    };
    try {
      const convertedQty = convertUnits(ing.quantity, ing.unit, item.unit, {
        itemUnit: item.unit,
        eq: item.equivalenceQty && item.equivalenceUnit ? { qty: item.equivalenceQty, unit: item.equivalenceUnit } : null,
      });
      return { ...base, convertedQty, cost: convertedQty * Number(item.costPerUnit), error: null };
    } catch (err) {
      // Datos viejos con una unidad que no se entiende: se avisa, no se inventa un costo
      return { ...base, convertedQty: null, cost: null, error: err instanceof UnitError ? err.message : 'No se pudo convertir' };
    }
  });
  const warnings = lines.filter(l => l.error).map(l => `${l.name}: ${l.error}`);
  const costTotal = lines.reduce((sum, l) => sum + (l.cost ?? 0), 0);
  const costPerServing = recipe.yield > 0 ? costTotal / recipe.yield : costTotal;
  const suggestedPrice = costPerServing * (1 + recipe.profitPct) * (1 + recipe.vatPct);
  const menuItemPrice = recipe.menuItem ? Number(recipe.menuItem.price) : null;

  return {
    costTotal,
    lines,
    warnings,
    complete: warnings.length === 0,
    costPerServing,
    suggestedPrice,
    menuItemPrice,
    priceDiff: menuItemPrice !== null ? menuItemPrice - suggestedPrice : null,
  };
}

export const recipesService = {
  async list(restaurantId: number) {
    const recipes = await prisma.recipe.findMany({
      where: { restaurantId },
      include: recipeInclude,
      orderBy: { name: 'asc' },
    });
    return recipes.map(r => ({ ...r, cost: computeCost(r) }));
  },

  async getById(restaurantId: number, id: number) {
    const recipe = await prisma.recipe.findFirst({
      where: { id, restaurantId },
      include: recipeInclude,
    });
    if (!recipe) throw HttpError.notFound('Receta no encontrada');
    return { ...recipe, cost: computeCost(recipe) };
  },

  async create(restaurantId: number, data: CreateRecipeData) {
    if (data.menuItemId) {
      const menuItem = await prisma.menuItem.findFirst({ where: { id: data.menuItemId, restaurantId } });
      if (!menuItem) throw HttpError.badRequest('El ítem del menú indicado no existe');
    }
    const ingredients = await validateIngredients(restaurantId, data.ingredients);

    const recipe = await prisma.recipe.create({
      data: {
        restaurantId,
        name: data.name,
        menuItemId: data.menuItemId ?? null,
        yield: data.yield ?? 1,
        profitPct: data.profitPct ?? 0.5,
        vatPct: data.vatPct ?? 0.21,
        notes: data.notes ?? null,
        ingredients: { create: ingredients },
      },
      include: recipeInclude,
    });
    return { ...recipe, cost: computeCost(recipe) };
  },

  async update(restaurantId: number, id: number, data: UpdateRecipeData) {
    await recipesService.getById(restaurantId, id);

    if (data.menuItemId) {
      const menuItem = await prisma.menuItem.findFirst({ where: { id: data.menuItemId, restaurantId } });
      if (!menuItem) throw HttpError.badRequest('El ítem del menú indicado no existe');
    }
    const ingredients = data.ingredients ? await validateIngredients(restaurantId, data.ingredients) : null;

    const recipe = await prisma.$transaction(async (tx) => {
      if (data.ingredients) {
        await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
      }
      return tx.recipe.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.menuItemId !== undefined ? { menuItemId: data.menuItemId } : {}),
          ...(data.yield !== undefined ? { yield: data.yield } : {}),
          ...(data.profitPct !== undefined ? { profitPct: data.profitPct } : {}),
          ...(data.vatPct !== undefined ? { vatPct: data.vatPct } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(ingredients ? { ingredients: { create: ingredients } } : {}),
        },
        include: recipeInclude,
      });
    });

    return { ...recipe, cost: computeCost(recipe) };
  },

  async remove(restaurantId: number, id: number): Promise<void> {
    await recipesService.getById(restaurantId, id);
    await prisma.recipe.delete({ where: { id } });
  },
};

/**
 * Los ingredientes existen en el inventario del restaurante y su unidad se
 * puede convertir a la del insumo (tarea 2.1). Devuelve las líneas a guardar,
 * con la unidad normalizada ("Grs" → "g").
 */
async function validateIngredients(restaurantId: number, ingredients: RecipeIngredientInput[]) {
  if (ingredients.length === 0) throw HttpError.badRequest('La receta debe tener al menos un ingrediente');
  const ids = ingredients.map(i => i.inventoryItemId);
  const items = await prisma.inventoryItem.findMany({ where: { id: { in: ids }, restaurantId } });
  if (items.length !== new Set(ids).size) {
    throw HttpError.badRequest('Alguno de los ingredientes no existe en el inventario de este restaurante');
  }
  const byId = new Map(items.map(i => [i.id, i]));
  return ingredients.map((ing) => {
    const item = byId.get(ing.inventoryItemId)!;
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
    return { inventoryItemId: ing.inventoryItemId, quantity: ing.quantity, unit };
  });
}
