// ──────────────────────────────────────────────
// Caja (tarea 5.1): una sola caja por local, apertura, ingresos/egresos y cierre con arqueo.
// Cobrar nunca se bloquea por la caja: lo cobrado con la caja cerrada entra en la siguiente.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { accountsService } from '../src/modules/accounts/accounts.service.js';
import { cashService } from '../src/modules/cash/cash.service.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
after(async () => {
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  httpServer.close();
});
beforeEach(async () => { await prisma.restaurant.deleteMany(); });

const isHttp = (status: number) => (err: unknown) => err instanceof HttpError && err.statusCode === status;

async function setup() {
  const r = (await prisma.restaurant.create({ data: { name: 'Test' } })).id;
  const dish = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Milanesa', category: 'main', price: '1000.00' } });
  let n = 0;
  /** Abre una mesa con `qty` platos de $1.000 y la cobra con el medio indicado. */
  const sell = async (paymentMethod: 'CASH' | 'CARD' | 'TRANSFER', qty = 1, amount?: number) => {
    const t = await prisma.table.create({ data: { restaurantId: r, number: ++n } });
    await ordersService.create(r, { tableId: t.id, guestCount: 1, items: [{ menuItemId: dish.id, quantity: qty }] });
    return salesService.create(r, { tableId: t.id, paymentMethod, amount: amount ?? qty * 1000 });
  };
  return { r, dish, sell };
}

test('una sola caja abierta por local (también si dos la abren a la vez)', async () => {
  const { r } = await setup();
  const results = await Promise.allSettled([cashService.open(r, 5000, null), cashService.open(r, 5000, null)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  await assert.rejects(cashService.open(r, 1000, null), isHttp(409));
  await assert.rejects(cashService.open(r, -1, null), isHttp(400));
});

test('arqueo: esperado = apertura + efectivo cobrado (sin vuelto) + ingresos − egresos', async () => {
  const { r, sell } = await setup();
  await cashService.open(r, 5000, null);
  await sell('CASH', 2, 5000);          // cuenta $2.000, pagó con $5.000: entran $2.000
  await sell('CARD', 3);                // $3.000 con tarjeta (no es efectivo)
  await sell('TRANSFER', 1);
  await cashService.addMovement(r, { type: 'IN', amount: 1500, reason: 'trajeron cambio', userId: null });
  await cashService.addMovement(r, { type: 'OUT', amount: 800, reason: 'pago al verdulero', userId: null });

  const cur = await cashService.current(r);
  const s = cur.open!.summary;
  assert.equal(s.sales.CASH.amount, 2000);
  assert.equal(s.sales.CARD.amount, 3000);
  assert.equal(s.sales.TRANSFER.amount, 1000);
  assert.equal(s.totalCollected, 6000);
  assert.equal(s.expectedCash, 5000 + 2000 + 1500 - 800);

  // Faltan $200 al contar
  const closed = await cashService.close(r, { countedCash: 7500, notes: 'faltó cambio', userId: null });
  assert.equal(Number(closed.expectedCash), 7700);
  assert.equal(Number(closed.difference), -200);
  assert.equal(closed.openKey, null);
  await assert.rejects(cashService.close(r, { countedCash: 1, userId: null }), isHttp(409));
  const actions = (await prisma.auditLog.findMany({ where: { restaurantId: r }, orderBy: { id: 'asc' } })).map(a => a.action);
  assert.deepEqual(actions.filter(a => a.startsWith('cash.')), ['cash.open', 'cash.movement', 'cash.movement', 'cash.close']);
});

test('cobrar con la caja cerrada se puede, y entra en la próxima caja', async () => {
  const { r, sell } = await setup();
  await cashService.open(r, 0, null);
  await sell('CASH', 1);
  await cashService.close(r, { countedCash: 1000, userId: null });

  await sell('CASH', 2);   // nadie abrió la caja todavía
  const closedNow = await cashService.current(r);
  assert.equal(closedNow.open, null);
  assert.equal(closedNow.salesSinceLastClose!.count, 1);

  await cashService.open(r, 0, null);
  await sell('CASH', 4);
  const s = (await cashService.current(r)).open!.summary;
  assert.equal(s.sales.CASH.amount, 6000);      // las $2.000 de antes de abrir + $4.000
  assert.equal(s.salesBeforeOpening, 1);
  // La venta de la caja anterior no se cuenta dos veces
  assert.equal(s.sales.CASH.count, 2);
});

test('a cuenta no suma efectivo; el cobro de cuenta corriente en efectivo sí', async () => {
  const { r, dish } = await setup();
  const muni = await accountsService.createCustomer(r, { name: 'Municipalidad' });
  await cashService.open(r, 0, null);
  const t = await prisma.table.create({ data: { restaurantId: r, number: 50 } });
  await ordersService.create(r, { tableId: t.id, guestCount: 1, items: [{ menuItemId: dish.id, quantity: 2 }] });
  const sale = await salesService.create(r, { tableId: t.id, paymentMethod: 'ACCOUNT', customerId: muni.id, amount: 0 });
  let s = (await cashService.current(r)).open!.summary;
  assert.equal(s.onAccount.amount, 2000);
  assert.equal(s.expectedCash, 0);
  await accountsService.registerPayment(r, { customerId: muni.id, saleIds: [sale.id], surchargePct: 20, paymentMethod: 'CASH', userId: null });
  s = (await cashService.current(r)).open!.summary;
  assert.equal(s.accountPayments.CASH.amount, 2400);
  assert.equal(s.expectedCash, 2400);
});

test('ingresos y egresos: solo con la caja abierta, con motivo y monto positivo', async () => {
  const { r } = await setup();
  await assert.rejects(cashService.addMovement(r, { type: 'OUT', amount: 100, reason: 'algo', userId: null }), isHttp(409));
  await cashService.open(r, 0, null);
  await assert.rejects(cashService.addMovement(r, { type: 'OUT', amount: 0, reason: 'algo', userId: null }), isHttp(400));
  await assert.rejects(cashService.addMovement(r, { type: 'OUT', amount: 100, reason: ' ', userId: null }), isHttp(400));
});

test('el historial guarda el resumen tal como estaba al cerrar', async () => {
  const { r, sell } = await setup();
  await cashService.open(r, 1000, null);
  await sell('CASH', 1);
  await cashService.close(r, { countedCash: 2000, userId: null });
  const [h] = await cashService.history(r);
  assert.equal(h.difference, 0);
  assert.equal(h.summary.sales.CASH.amount, 1000);
  assert.equal(h.summary.expectedCash, 2000);
});
