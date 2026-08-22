// ──────────────────────────────────────────────
// recipes.service.ts — Recetas y costos
//
// Costo de elaboración = suma de (cantidad de cada ingrediente × costPerUnit
// del InventoryItem). Como costPerUnit vive en InventoryItem, el costo de
// toda receta que lo use queda actualizado automáticamente al leer (no se
// desnormaliza ni se cachea).
//
// Precio sugerido = costo por porción × (1 + profitPct) × (1 + vatPct).
// ──────────────────────────────────────────────
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';

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

export interface RecipeCost {
  costTotal: number;
  costPerServing: number;
  suggestedPrice: number;
  menuItemPrice: number | null;
  priceDiff: number | null; // menuItemPrice - suggestedPrice
}

const recipeInclude = {
  ingredients: { include: { inventoryItem: true } },
  menuItem: true,
} as const;

function computeCost(
  recipe: { yield: number; profitPct: number; vatPct: number; menuItem: { price: unknown } | null;
    ingredients: Array<{ quantity: number; inventoryItem: { costPerUnit: unknown } }> }
): RecipeCost {
  const costTotal = recipe.ingredients.reduce(
    (sum, ing) => sum + ing.quantity * Number(ing.inventoryItem.costPerUnit),
    0
  );
  const costPerServing = recipe.yield > 0 ? costTotal / recipe.yield : costTotal;
  const suggestedPrice = costPerServing * (1 + recipe.profitPct) * (1 + recipe.vatPct);
  const menuItemPrice = recipe.menuItem ? Number(recipe.menuItem.price) : null;

  return {
    costTotal,
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
    await assertIngredientsBelongToRestaurant(restaurantId, data.ingredients);

    const recipe = await prisma.recipe.create({
      data: {
        restaurantId,
        name: data.name,
        menuItemId: data.menuItemId ?? null,
        yield: data.yield ?? 1,
        profitPct: data.profitPct ?? 0.5,
        vatPct: data.vatPct ?? 0.21,
        notes: data.notes ?? null,
        ingredients: {
          create: data.ingredients.map(ing => ({
            inventoryItemId: ing.inventoryItemId,
            quantity: ing.quantity,
            unit: ing.unit,
          })),
        },
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
    if (data.ingredients) {
      await assertIngredientsBelongToRestaurant(restaurantId, data.ingredients);
    }

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
          ...(data.ingredients ? {
            ingredients: {
              create: data.ingredients.map(ing => ({
                inventoryItemId: ing.inventoryItemId,
                quantity: ing.quantity,
                unit: ing.unit,
              })),
            },
          } : {}),
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

async function assertIngredientsBelongToRestaurant(restaurantId: number, ingredients: RecipeIngredientInput[]) {
  if (ingredients.length === 0) throw HttpError.badRequest('La receta debe tener al menos un ingrediente');
  const ids = ingredients.map(i => i.inventoryItemId);
  const count = await prisma.inventoryItem.count({ where: { id: { in: ids }, restaurantId } });
  if (count !== new Set(ids).size) {
    throw HttpError.badRequest('Alguno de los ingredientes no existe en el inventario de este restaurante');
  }
}
