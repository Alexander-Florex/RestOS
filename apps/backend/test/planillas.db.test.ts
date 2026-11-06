// ──────────────────────────────────────────────
// planillas.db.test.ts — Importador de planillas contra la base (tarea 2.9):
// escribe lo planeado, el costo de la app coincide con el del plan, y volver
// a correrlo no duplica nada ni pisa lo cargado a mano.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { parseWorkbooks } from '../src/lib/planillas/parse.js';
import { buildPlan } from '../src/lib/planillas/plan.js';
import { applyPlan } from '../src/lib/planillas/apply.js';
import { recipesService } from '../src/modules/recipes/recipes.service.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';
import { createDefaultStorageAreas } from '../src/lib/default-storage-areas.js';
import { buildFixture } from './planillas-fixture.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
async function clean() {
  await prisma.recipeIngredient.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.restaurant.deleteMany();
}
after(async () => {
  await clean();
  await prisma.$disconnect();
  httpServer.close();
});
beforeEach(clean);

const close = (a: number | null | undefined, b: number) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);

function plan() {
  const { costs, stock } = buildFixture();
  return buildPlan(parseWorkbooks(costs, stock));
}

async function restaurant() {
  const r = await prisma.restaurant.create({ data: { name: 'Test' } });
  await createDefaultStorageAreas(prisma, r.id);
  return r.id;
}

async function snapshot(rid: number) {
  return {
    items: await prisma.inventoryItem.count({ where: { restaurantId: rid } }),
    recipes: await prisma.recipe.count({ where: { restaurantId: rid } }),
    lines: await prisma.recipeIngredient.count({ where: { recipe: { restaurantId: rid } } }),
    areas: await prisma.storageArea.count({ where: { restaurantId: rid } }),
    prices: await prisma.priceHistory.count({ where: { restaurantId: rid } }),
    moves: await prisma.stockMovement.count({ where: { restaurantId: rid } }),
  };
}

test('importa insumos, sectores y recetas; el costo de la app coincide con el plan', async () => {
  const rid = await restaurant();
  const p = plan();
  const result = await applyPlan(p, rid);
  assert.equal(result.recipesFailed.length, 0, JSON.stringify(result.recipesFailed));
  assert.equal(result.itemsCreated, p.items.length);
  assert.equal(result.recipesCreated, p.recipes.length);
  assert.equal(result.areasCreated, 0, 'los 7 sectores ya existían');

  const harina = await prisma.inventoryItem.findFirstOrThrow({ where: { restaurantId: rid, name: 'Harina 0000' }, include: { storageArea: true } });
  assert.equal(harina.unit, 'kg');
  assert.equal(harina.purchaseQty, 25);
  close(Number(harina.costPerUnit), 1000);
  assert.equal(harina.quantity, 0, 'el stock arranca en 0: lo carga el primer conteo');
  assert.equal(harina.storageArea?.name, 'Estanterías depósito');
  assert.equal(harina.countOrder, 1);
  const hist = await prisma.priceHistory.findFirstOrThrow({ where: { inventoryItemId: harina.id } });
  assert.equal(hist.source, 'IMPORT');
  assert.equal(await prisma.stockMovement.count({ where: { restaurantId: rid } }), 0);

  for (const planned of p.recipes) {
    const db = await prisma.recipe.findFirstOrThrow({ where: { restaurantId: rid, name: planned.name } });
    const withCost = await recipesService.getById(rid, db.id);
    close(withCost.cost.costPerServing, planned.systemUnitCost!);
    assert.equal(withCost.cost.complete, true, `${planned.name}: ${withCost.cost.warnings.join(', ')}`);
  }
  const lw = await prisma.recipe.findFirstOrThrow({ where: { restaurantId: rid, name: 'Lomo Wellington' } });
  assert.equal(lw.profitPct, 0.48);
});

test('volver a importar no duplica nada ni toca lo cargado a mano', async () => {
  const rid = await restaurant();
  // Algo que el cliente ya había cargado: mismo insumo con otro precio y stock
  const leche = await inventoryService.create(rid, { name: 'LECHE', category: 'FOOD', quantity: 12, unit: 'l', costPerUnit: 3000 });

  const first = await applyPlan(plan(), rid);
  assert.equal(first.itemsExisting, 1);
  const before = await snapshot(rid);

  const second = await applyPlan(plan(), rid);
  assert.equal(second.itemsCreated, 0);
  assert.equal(second.recipesCreated, 0);
  assert.equal(second.recipesExisting, plan().recipes.length);
  assert.deepEqual(await snapshot(rid), before);

  const after = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: leche.id } });
  close(Number(after.costPerUnit), 3000);
  assert.equal(after.quantity, 12);

  // Con --update sí se actualiza el precio (queda en el historial como importación), pero no el stock
  const third = await applyPlan(plan(), rid, { update: true });
  assert.ok(third.itemsUpdated > 0);
  const updated = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: leche.id } });
  assert.equal(updated.quantity, 12);
  assert.equal((await snapshot(rid)).items, before.items);
});

test('si una sub-receta falla, la que la usa no se crea incompleta; arreglado, se importan las dos', async () => {
  const rid = await restaurant();
  // Insumo viejo con una unidad que no existe (como el "Vino Tinto" en botellas del demo)
  const vinagre = await prisma.inventoryItem.create({ data: { restaurantId: rid, name: 'Vinagre', category: 'FOOD', quantity: 0, unit: 'botella' } });
  const first = await applyPlan(plan(), rid);
  const failed = Object.fromEntries(first.recipesFailed.map(f => [f.name, f.error]));
  assert.match(failed['Chimichurri'], /botella/);
  assert.match(failed['Lomo Wellington'], /usa «Chimichurri», que no se pudo importar/);
  assert.equal(await prisma.recipe.count({ where: { restaurantId: rid, name: 'Lomo Wellington' } }), 0);

  await prisma.inventoryItem.update({ where: { id: vinagre.id }, data: { unit: 'l' } });
  const second = await applyPlan(plan(), rid);
  assert.deepEqual(second.recipesFailed, []);
  assert.equal(second.recipesCreated, 2);
  const lw = await prisma.recipe.findFirstOrThrow({ where: { restaurantId: rid, name: 'Lomo Wellington' }, include: { ingredients: true } });
  assert.ok(lw.ingredients.some(i => i.subRecipeId !== null));
});

test('otro restaurante no se ve afectado', async () => {
  const rid = await restaurant();
  const other = await restaurant();
  await applyPlan(plan(), rid);
  assert.equal(await prisma.inventoryItem.count({ where: { restaurantId: other } }), 0);
  assert.equal(await prisma.recipe.count({ where: { restaurantId: other } }), 0);
  await assert.rejects(applyPlan(plan(), 999_999), /No existe el restaurante/);
});
