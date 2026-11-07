// ──────────────────────────────────────────────
// stock.db.test.ts — Stock real (Fase 3): sectores (3.1), movimientos (3.2)
// y toma de inventario (3.3). Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';
import { storageAreasService } from '../src/modules/storage-areas/storage-areas.service.js';
import { stockCountsService } from '../src/modules/stock-counts/stock-counts.service.js';
import { createDefaultStorageAreas, DEFAULT_STORAGE_AREAS } from '../src/lib/default-storage-areas.js';

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

function item(rid: number, name: string, quantity: number, extra: Record<string, unknown> = {}) {
  return inventoryService.create(rid, { name, category: 'FOOD', quantity, unit: 'kg', costPerUnit: 1000, ...extra });
}

/** El saldo guardado tiene que ser la suma de los movimientos, y cada saldo parcial, coherente. */
async function assertLedger(itemId: number) {
  const it = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
  const moves = await prisma.stockMovement.findMany({ where: { inventoryItemId: itemId }, orderBy: { id: 'asc' } });
  let running = 0;
  for (const m of moves) {
    running += m.quantity;
    close(m.balanceAfter, running);
  }
  close(it.quantity, running);
  return moves;
}

// ── 3.2 Movimientos ──

test('alta con cantidad: entra como movimiento "saldo inicial"', async () => {
  const rid = await restaurant();
  const harina = await item(rid, 'Harina', 25);
  const moves = await assertLedger(harina.id);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].type, 'ADJUSTMENT');
  assert.equal(moves[0].reason, 'Saldo inicial');
  close(Number(moves[0].unitCost), 1000);

  const vacio = await item(rid, 'Sal', 0);
  assert.equal((await assertLedger(vacio.id)).length, 0);
});

test('reponer, consumir y ajustar dejan su movimiento; el saldo es la suma', async () => {
  const rid = await restaurant();
  const it = await item(rid, 'Papa', 10);
  await inventoryService.restock(rid, it.id, 5);
  await inventoryService.consume(rid, it.id, 2.5, 'Prueba de cocina');
  const adj = await inventoryService.adjust(rid, it.id, 11, 'Se encontró una bolsa');
  close(adj.quantity, 11);

  const moves = await assertLedger(it.id);
  assert.deepEqual(moves.map(m => m.type), ['ADJUSTMENT', 'PURCHASE', 'CONSUMPTION', 'ADJUSTMENT']);
  assert.deepEqual(moves.map(m => m.quantity), [10, 5, -2.5, -1.5]);
  assert.equal(moves[2].reason, 'Prueba de cocina');
  assert.equal(moves[3].reason, 'Se encontró una bolsa');

  const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'inventory.adjust' } });
  assert.equal(log.reason, 'Se encontró una bolsa');
});

test('reponer con precio nuevo guarda el costo nuevo en el movimiento', async () => {
  const rid = await restaurant();
  const it = await item(rid, 'Harina', 0, { costPerUnit: undefined, purchaseQty: 25, purchaseUnit: 'kg', purchasePrice: 25000 });
  await inventoryService.restock(rid, it.id, { presentations: 2, purchasePrice: 30000 });
  const [m] = await assertLedger(it.id);
  assert.equal(m.type, 'PURCHASE');
  close(m.quantity, 50);
  close(Number(m.unitCost), 1200);
  assert.match(m.reference ?? '', /2 × 25 kg/);
});

test('consumir más de lo que hay o ajustar sin motivo: se rechaza y no deja movimiento', async () => {
  const rid = await restaurant();
  const it = await item(rid, 'Queso', 3);
  await rejectsWith(inventoryService.consume(rid, it.id, 4), 400, /No hay stock suficiente/);
  await rejectsWith(inventoryService.adjust(rid, it.id, 2, '  '), 400, /motivo/);
  await rejectsWith(inventoryService.adjust(rid, it.id, 3, 'Igual'), 400, /ya tiene/);
  await rejectsWith(inventoryService.adjust(rid, it.id, -1, 'Negativo'), 400);
  assert.equal((await assertLedger(it.id)).length, 1);
});

test('editar el insumo no cambia la cantidad (va por movimientos)', async () => {
  const rid = await restaurant();
  const it = await item(rid, 'Aceite', 7);
  // Un cliente viejo que todavía manda quantity: se ignora
  const upd = await inventoryService.update(rid, it.id, { name: 'Aceite de girasol', quantity: 100 } as never);
  close(upd.quantity, 7);
  assert.equal(upd.name, 'Aceite de girasol');
  assert.equal((await assertLedger(it.id)).length, 1);
});

test('concurrencia: 10 reposiciones y consumos a la vez no se pisan', async () => {
  const rid = await restaurant();
  const it = await item(rid, 'Tomate', 20);
  await Promise.all([
    ...Array.from({ length: 6 }, () => inventoryService.restock(rid, it.id, 1.5)),
    ...Array.from({ length: 4 }, () => inventoryService.consume(rid, it.id, 2)),
  ]);
  const moves = await assertLedger(it.id);
  assert.equal(moves.length, 11);
  close((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: it.id } })).quantity, 20 + 9 - 8);
});

test('movimientos: otro restaurante no los ve ni puede ajustar', async () => {
  const rid = await restaurant();
  const other = await restaurant();
  const it = await item(rid, 'Pollo', 5);
  await rejectsWith(inventoryService.movements(other, it.id), 404);
  await rejectsWith(inventoryService.adjust(other, it.id, 1, 'Intruso'), 404);
  await rejectsWith(inventoryService.restock(other, it.id, 1), 404);
  close((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: it.id } })).quantity, 5);
});

// ── 3.1 Sectores ──

test('sectores: los 7 de la planilla, sin duplicar; borrar uno deja sus insumos sin sector', async () => {
  const rid = await restaurant();
  await createDefaultStorageAreas(prisma, rid);
  await createDefaultStorageAreas(prisma, rid);
  const areas = await storageAreasService.list(rid);
  assert.deepEqual(areas.map(a => a.name), [...DEFAULT_STORAGE_AREAS]);

  const carnes = areas[0];
  const it = await item(rid, 'Vacío', 4, { storageAreaId: carnes.id });
  assert.equal(it.storageAreaId, carnes.id);
  assert.equal((await storageAreasService.list(rid))[0].itemCount, 1);

  await rejectsWith(storageAreasService.create(rid, { name: 'Pastas' }), 409, /Ya existe/);
  await storageAreasService.remove(rid, carnes.id);
  const after = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: it.id } });
  assert.equal(after.storageAreaId, null);
  close(after.quantity, 4);
});

test('sectores: no se puede asignar uno de otro restaurante', async () => {
  const rid = await restaurant();
  const other = await restaurant();
  const ajeno = await storageAreasService.create(other, { name: 'Depósito' });
  await rejectsWith(item(rid, 'Arroz', 1, { storageAreaId: ajeno.id }), 400, /Sector/);
  const it = await item(rid, 'Arroz', 1);
  await rejectsWith(inventoryService.update(rid, it.id, { storageAreaId: ajeno.id }), 400, /Sector/);
  await rejectsWith(storageAreasService.update(rid, ajeno.id, { name: 'Mío' }), 404);
  await rejectsWith(storageAreasService.remove(rid, ajeno.id), 404);
});

// ── 3.3 Toma de inventario ──

async function setup() {
  const rid = await restaurant();
  const camara = await storageAreasService.create(rid, { name: 'Cámara' });
  const deposito = await storageAreasService.create(rid, { name: 'Depósito' });
  const leche = await item(rid, 'Leche', 10, { storageAreaId: camara.id, countOrder: 2 });
  const queso = await item(rid, 'Queso', 5, { storageAreaId: camara.id, countOrder: 1 });
  const crema = await item(rid, 'Crema', 2, { storageAreaId: camara.id, countOrder: 3 });
  const arroz = await item(rid, 'Arroz', 8, { storageAreaId: deposito.id });
  return { rid, camara, deposito, leche, queso, crema, arroz };
}

test('conteo: solo el sector, en su orden, y a ciegas mientras está abierto', async () => {
  const { rid, camara } = await setup();
  const count = await stockCountsService.create(rid, { storageAreaId: camara.id });
  assert.equal(count.status, 'OPEN');
  assert.equal(count.areaName, 'Cámara');
  assert.deepEqual(count.lines.map(l => l.itemName), ['Queso', 'Leche', 'Crema']);
  assert.ok(count.lines.every(l => l.expectedQty === null && l.countedQty === null));
});

test('conteo: al cerrar corrige las diferencias; lo no contado no se toca', async () => {
  const { rid, camara, leche, queso, crema } = await setup();
  const count = await stockCountsService.create(rid, { storageAreaId: camara.id });
  const line = (name: string) => count.lines.find(l => l.itemName === name)!;
  await stockCountsService.setLine(rid, count.id, line('Leche').id, { countedQty: 8, reason: 'Se cortó una' });
  await stockCountsService.setLine(rid, count.id, line('Queso').id, { countedQty: 5 });
  // Crema no se cuenta

  const preview = await stockCountsService.summary(rid, count.id);
  assert.equal(preview.uncounted, 1);
  assert.equal(preview.differences.length, 1);
  close(preview.differences[0].difference, -2);
  close(preview.differenceValue, -2000);

  const { summary } = await stockCountsService.close(rid, count.id, { notes: 'Domingo' });
  assert.equal(summary.differences, 1);
  close(summary.differenceValue, -2000);

  close((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: leche.id } })).quantity, 8);
  close((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: queso.id } })).quantity, 5);
  close((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: crema.id } })).quantity, 2);

  const moves = await assertLedger(leche.id);
  const last = moves.at(-1)!;
  assert.equal(last.type, 'COUNT');
  assert.equal(last.stockCountId, count.id);
  assert.equal(last.reason, 'Se cortó una');
  assert.equal((await assertLedger(queso.id)).length, 1, 'sin diferencia no hay movimiento');
  assert.equal((await assertLedger(crema.id)).length, 1, 'lo no contado no se toca');

  const closed = await stockCountsService.get(rid, count.id);
  assert.equal(closed.status, 'CLOSED');
  const l = closed.lines.find(x => x.itemName === 'Leche')!;
  close(l.expectedQty!, 10);
  close(l.difference!, -2);
  assert.equal(closed.lines.find(x => x.itemName === 'Crema')!.expectedQty, null);

  const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'inventory.count.close' } });
  assert.equal(log.reason, 'Domingo');
});

test('conteo: compara contra el stock al cerrar (aunque haya habido movimientos en el medio)', async () => {
  const { rid, deposito, arroz } = await setup();
  const count = await stockCountsService.create(rid, { storageAreaId: deposito.id });
  await stockCountsService.setLine(rid, count.id, count.lines[0].id, { countedQty: 12 });
  await inventoryService.restock(rid, arroz.id, 4); // llegó mercadería mientras contaban: 8 + 4 = 12
  const { summary } = await stockCountsService.close(rid, count.id, {});
  assert.equal(summary.differences, 0);
  close((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: arroz.id } })).quantity, 12);
  await assertLedger(arroz.id);
});

test('conteo: cerrar dos veces a la vez aplica una sola vez', async () => {
  const { rid, camara, leche } = await setup();
  const count = await stockCountsService.create(rid, { storageAreaId: camara.id });
  await stockCountsService.setLine(rid, count.id, count.lines.find(l => l.itemName === 'Leche')!.id, { countedQty: 13 });
  const results = await Promise.allSettled([
    stockCountsService.close(rid, count.id, {}),
    stockCountsService.close(rid, count.id, {}),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(failed.reason instanceof HttpError && failed.reason.statusCode === 409);
  close((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: leche.id } })).quantity, 13);
  assert.equal((await assertLedger(leche.id)).filter(m => m.type === 'COUNT').length, 1);
});

test('conteo: cerrado o descartado ya no se modifica', async () => {
  const { rid, camara } = await setup();
  const count = await stockCountsService.create(rid, { storageAreaId: camara.id });
  await stockCountsService.close(rid, count.id, {});
  await rejectsWith(stockCountsService.setLine(rid, count.id, count.lines[0].id, { countedQty: 1 }), 409);
  await rejectsWith(stockCountsService.cancel(rid, count.id), 409);
  await rejectsWith(stockCountsService.summary(rid, count.id), 409);
});

test('conteo: uno abierto por sector; "todo" no se mezcla con sectores; descartar libera', async () => {
  const { rid, camara, deposito, leche } = await setup();
  const first = await stockCountsService.create(rid, { storageAreaId: camara.id });
  await rejectsWith(stockCountsService.create(rid, { storageAreaId: camara.id }), 409, /Ya hay un conteo abierto/);
  await rejectsWith(stockCountsService.create(rid, { storageAreaId: null }), 409, /Cámara/);
  // Otro sector a la vez sí (dos personas contando)
  const second = await stockCountsService.create(rid, { storageAreaId: deposito.id });

  await stockCountsService.setLine(rid, first.id, first.lines[0].id, { countedQty: 99 });
  await stockCountsService.cancel(rid, first.id, 'Me equivoqué de sector');
  close((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: leche.id } })).quantity, 10);
  await stockCountsService.cancel(rid, second.id);

  const all = await stockCountsService.create(rid, { storageAreaId: null });
  assert.equal(all.areaName, 'Todo el stock');
  assert.equal(all.lines.length, 4);
  await rejectsWith(stockCountsService.create(rid, { storageAreaId: deposito.id }), 409, /Todo el stock/);
});

test('conteo: sector vacío no se abre', async () => {
  const rid = await restaurant();
  const vacio = await storageAreasService.create(rid, { name: 'Vacío' });
  await rejectsWith(stockCountsService.create(rid, { storageAreaId: vacio.id }), 400, /no tiene insumos/);
});

test('conteo: insumo borrado mientras se contaba se saltea al cerrar', async () => {
  const { rid, camara, crema } = await setup();
  const count = await stockCountsService.create(rid, { storageAreaId: camara.id });
  await stockCountsService.setLine(rid, count.id, count.lines.find(l => l.itemName === 'Crema')!.id, { countedQty: 1 });
  await inventoryService.remove(rid, crema.id);
  const { summary } = await stockCountsService.close(rid, count.id, {});
  assert.equal(summary.differences, 0);
  const closed = await stockCountsService.get(rid, count.id);
  assert.equal(closed.lines.find(l => l.itemName === 'Crema')!.inventoryItemId, null);
});

test('conteo: otro restaurante no lo ve ni lo toca', async () => {
  const { rid, camara } = await setup();
  const other = await restaurant();
  const count = await stockCountsService.create(rid, { storageAreaId: camara.id });
  await rejectsWith(stockCountsService.get(other, count.id), 404);
  await rejectsWith(stockCountsService.setLine(other, count.id, count.lines[0].id, { countedQty: 1 }), 404);
  await rejectsWith(stockCountsService.close(other, count.id, {}), 404);
  await rejectsWith(stockCountsService.cancel(other, count.id), 404);
  await rejectsWith(stockCountsService.create(other, { storageAreaId: camara.id }), 400, /Sector/);
  assert.equal((await stockCountsService.list(other)).length, 0);
  // Una línea de otro conteo no se puede tocar por este
  const otherArea = await storageAreasService.create(other, { name: 'X' });
  await item(other, 'Y', 1, { storageAreaId: otherArea.id });
  const otherCount = await stockCountsService.create(other, { storageAreaId: otherArea.id });
  await rejectsWith(stockCountsService.setLine(rid, count.id, otherCount.lines[0].id, { countedQty: 1 }), 404);
});
