// ──────────────────────────────────────────────
// recipes.db.test.ts — Costo de recetas con conversión de unidades (tarea 2.1)
// Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';
import { recipesService } from '../src/modules/recipes/recipes.service.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
after(async () => {
  await clean();
  await prisma.$disconnect();
  httpServer.close();
});
// Las recetas se borran primero: RecipeIngredient → InventoryItem es Restrict
async function clean() { await prisma.recipe.deleteMany(); await prisma.restaurant.deleteMany(); }
beforeEach(clean);

async function setup() {
  const restaurant = await prisma.restaurant.create({ data: { name: 'Test' } });
  const restaurantId = restaurant.id;
  const harina = await inventoryService.create(restaurantId, { name: 'Harina 0000', category: 'FOOD', quantity: 25, unit: 'Kilos', costPerUnit: 1000 });
  const leche = await inventoryService.create(restaurantId, { name: 'Leche', category: 'FOOD', quantity: 10, unit: 'lts', costPerUnit: 1200 });
  const huevo = await inventoryService.create(restaurantId, { name: 'Huevo', category: 'FOOD', quantity: 60, unit: 'UNIDAD', costPerUnit: 150 });
  return { restaurantId, harina, leche, huevo };
}

async function rejectsWith(promise: Promise<unknown>, status: number, re?: RegExp) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof HttpError, String(err));
    assert.equal(err.statusCode, status, err.message);
    if (re) assert.match(err.message, re);
    return true;
  });
}

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test('insumos: las unidades de las planillas se guardan normalizadas; las desconocidas se rechazan', async () => {
  const { restaurantId, harina, leche, huevo } = await setup();
  assert.deepEqual([harina.unit, leche.unit, huevo.unit], ['kg', 'l', 'un']);
  await rejectsWith(inventoryService.create(restaurantId, { name: 'Azúcar', category: 'FOOD', quantity: 1, unit: 'bolsa' }), 400, /Unidad no reconocida/);
  await rejectsWith(inventoryService.update(restaurantId, huevo.id, { equivalenceQty: 12, equivalenceUnit: 'docena' }), 400, /otra familia/);
});

test('receta: 200 g de harina a $1.000/kg cuestan $200 (antes daba $200.000)', async () => {
  const { restaurantId, harina, leche } = await setup();
  const recipe = await recipesService.create(restaurantId, {
    name: 'Masa', yield: 4,
    ingredients: [
      { inventoryItemId: harina.id, quantity: 200, unit: 'Grs' },
      { inventoryItemId: leche.id, quantity: 250, unit: 'CC' },
    ],
  });
  assert.deepEqual(recipe.ingredients.map(i => i.unit), ['g', 'cc']); // guardadas normalizadas
  const [h, l] = recipe.cost.lines;
  close(h.convertedQty!, 0.2);
  close(h.cost!, 200);
  close(l.cost!, 300); // 0,25 l × $1.200
  close(recipe.cost.costTotal, 500);
  close(recipe.cost.costPerServing, 125);
  assert.equal(recipe.cost.complete, true);
});

test('gramos → unidades: se rechaza sin equivalencia; con "1 un = 60 g" se calcula', async () => {
  const { restaurantId, huevo } = await setup();
  await rejectsWith(recipesService.create(restaurantId, {
    name: 'Tortilla', ingredients: [{ inventoryItemId: huevo.id, quantity: 120, unit: 'g' }],
  }), 400, /Huevo.*sin una equivalencia/);

  await inventoryService.update(restaurantId, huevo.id, { equivalenceQty: 60, equivalenceUnit: 'gramos' });
  const recipe = await recipesService.create(restaurantId, {
    name: 'Tortilla', ingredients: [{ inventoryItemId: huevo.id, quantity: 120, unit: 'g' }],
  });
  close(recipe.cost.lines[0].convertedQty!, 2);
  close(recipe.cost.costTotal, 300);
  // Una docena también entra (misma familia que "un")
  const tarta = await recipesService.create(restaurantId, {
    name: 'Tarta', ingredients: [{ inventoryItemId: huevo.id, quantity: 1, unit: 'docena' }],
  });
  close(tarta.cost.costTotal, 1800);
});

test('datos viejos con una unidad que no se entiende: avisa y no inventa el costo', async () => {
  const { restaurantId, harina, leche } = await setup();
  const recipe = await recipesService.create(restaurantId, {
    name: 'Vieja', ingredients: [{ inventoryItemId: leche.id, quantity: 1, unit: 'l' }],
  });
  // Línea cargada antes de la tarea 2.1, sin validar
  await prisma.recipeIngredient.create({ data: { recipeId: recipe.id, inventoryItemId: harina.id, quantity: 3, unit: 'pizca' } });

  const saved = await recipesService.getById(restaurantId, recipe.id);
  assert.equal(saved.cost.complete, false);
  assert.match(saved.cost.warnings[0], /Harina 0000: No se reconoce la unidad "pizca"/);
  close(saved.cost.costTotal, 1200); // solo la leche
});
