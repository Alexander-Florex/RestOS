// ──────────────────────────────────────────────
// costing.db.test.ts — Costos de la Fase 2: presentaciones (2.2), historial
// de precios (2.5), merma (2.4), sub-recetas (2.3), precio y margen (2.6/2.7)
// y alertas (2.8). Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
// Las recetas se borran primero: RecipeIngredient → InventoryItem es Restrict
async function clean() { await prisma.recipe.deleteMany(); await prisma.restaurant.deleteMany(); }
after(async () => {
  await clean();
  await prisma.$disconnect();
  httpServer.close();
});
beforeEach(clean);

async function restaurant() {
  return (await prisma.restaurant.create({ data: { name: 'Test' } })).id;
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
const history = (id: number) => prisma.priceHistory.findMany({ where: { inventoryItemId: id }, orderBy: { id: 'asc' } });

// ── 2.2 Presentación de compra ──

test('presentación: el costo por unidad se calcula (bolsa 25 kg a $25.000 → $1.000/kg)', async () => {
  const rid = await restaurant();
  const harina = await inventoryService.create(rid, {
    name: 'Harina', category: 'FOOD', quantity: 0, unit: 'kg',
    purchaseQty: 25, purchaseUnit: 'kg', purchasePrice: 25000,
  });
  close(Number(harina.costPerUnit), 1000);

  // Presentación en otra unidad de la misma familia: 500 g a $800 → $1.600/kg
  const queso = await inventoryService.create(rid, {
    name: 'Queso', category: 'FOOD', quantity: 0, unit: 'kg', purchaseQty: 500, purchaseUnit: 'Grs', purchasePrice: 800,
  });
  close(Number(queso.costPerUnit), 1600);
  assert.equal(queso.purchaseUnit, 'g');

  // Maple de 30 huevos a $4.500 → $150 el huevo
  const huevo = await inventoryService.create(rid, {
    name: 'Huevo', category: 'FOOD', quantity: 0, unit: 'un', purchaseQty: 1, purchaseUnit: 'maple', purchasePrice: 4500,
  });
  close(Number(huevo.costPerUnit), 150);
});

test('presentación: incompleta o en otra familia sin equivalencia se rechaza', async () => {
  const rid = await restaurant();
  await rejectsWith(inventoryService.create(rid, {
    name: 'X', category: 'FOOD', quantity: 0, unit: 'kg', purchaseQty: 25, purchasePrice: 1000,
  }), 400, /cantidad, unidad y precio/);
  await rejectsWith(inventoryService.create(rid, {
    name: 'Limón', category: 'FOOD', quantity: 0, unit: 'un', purchaseQty: 1, purchaseUnit: 'kg', purchasePrice: 2000,
  }), 400, /Presentación: .*equivalencia/);
  // Con equivalencia (1 un = 125 g → 8 por kg) sí: $2.000/kg → $250 el limón
  const limon = await inventoryService.create(rid, {
    name: 'Limón', category: 'FOOD', quantity: 0, unit: 'un', equivalenceQty: 125, equivalenceUnit: 'g',
    purchaseQty: 1, purchaseUnit: 'kg', purchasePrice: 2000,
  });
  close(Number(limon.costPerUnit), 250);
});

test('con presentación manda el precio de la presentación; sin ella, el costo a mano', async () => {
  const rid = await restaurant();
  const item = await inventoryService.create(rid, {
    name: 'Aceite', category: 'FOOD', quantity: 0, unit: 'l', purchaseQty: 5, purchaseUnit: 'l', purchasePrice: 10000,
  });
  const ignored = await inventoryService.update(rid, item.id, { costPerUnit: 1 });
  close(Number(ignored.costPerUnit), 2000);

  const cleared = await inventoryService.update(rid, item.id, { purchaseQty: null, purchaseUnit: null, purchasePrice: null, costPerUnit: 2500 });
  assert.equal(cleared.purchaseQty, null);
  close(Number(cleared.costPerUnit), 2500);
});

test('reposición en presentaciones y con precio nuevo (2 bolsas a $26.000)', async () => {
  const rid = await restaurant();
  const harina = await inventoryService.create(rid, {
    name: 'Harina', category: 'FOOD', quantity: 10, unit: 'kg', purchaseQty: 25, purchaseUnit: 'kg', purchasePrice: 25000,
  });
  const restocked = await inventoryService.restock(rid, harina.id, { presentations: 2, purchasePrice: 26000 });
  close(restocked.quantity, 60);
  close(Number(restocked.costPerUnit), 1040);
  await rejectsWith(inventoryService.restock(rid, (await inventoryService.create(rid, {
    name: 'Sal', category: 'FOOD', quantity: 0, unit: 'kg', costPerUnit: 500,
  })).id, { presentations: 1 }), 400, /no tiene presentación/);
});

// ── 2.5 Historial de precios ──

test('historial: cada cambio de costo queda registrado con su origen; sin cambio, nada', async () => {
  const rid = await restaurant();
  const item = await inventoryService.create(rid, { name: 'Leche', category: 'FOOD', quantity: 0, unit: 'l', costPerUnit: 1000 });
  await inventoryService.update(rid, item.id, { name: 'Leche entera' });            // no cambia el costo
  await inventoryService.update(rid, item.id, { costPerUnit: 1100 });                 // a mano
  await inventoryService.update(rid, item.id, { purchaseQty: 1, purchaseUnit: 'l', purchasePrice: 1200 }); // presentación
  await inventoryService.restock(rid, item.id, { presentations: 10, purchasePrice: 1250 });                 // compra

  const rows = await history(item.id);
  assert.deepEqual(rows.map(r => [r.source, Number(r.previousCost ?? 0), Number(r.costPerUnit)]), [
    ['MANUAL', 0, 1000],
    ['MANUAL', 1000, 1100],
    ['MANUAL', 1100, 1200],
    ['PURCHASE', 1200, 1250],
  ]);
  const api = await inventoryService.priceHistory(rid, item.id);
  assert.equal(Number(api[0].costPerUnit), 1250); // el más nuevo primero
});
