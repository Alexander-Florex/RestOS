// ──────────────────────────────────────────────
// history.db.test.ts — Los pedidos no se borran (tarea 1.3):
// al cobrar pasan a PAID vinculados a la venta; al anular, a CANCELLED con motivo.
// Solo los OPEN cuentan para la cuenta de la mesa.
// Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { OrderStatus, TableStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { tablesService } from '../src/modules/tables/tables.service.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
after(async () => {
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  httpServer.close();
});
beforeEach(async () => { await prisma.restaurant.deleteMany(); });

async function setup() {
  const restaurant = await prisma.restaurant.create({ data: { name: 'Test' } });
  const restaurantId = restaurant.id;
  const table = await prisma.table.create({ data: { restaurantId, number: 1, capacity: 4 } });
  const dish = await prisma.menuItem.create({ data: { restaurantId, name: 'Milanesa', category: 'mains', price: '9000.00' } });
  const user = await prisma.user.create({
    data: { restaurantId, username: 'caja', email: 'caja@x', password: 'x', name: 'Caja', role: 'STAFF' },
  });
  const order = (quantity = 1, guestCount?: number) =>
    ordersService.create(restaurantId, { tableId: table.id, guestCount, items: [{ menuItemId: dish.id, quantity }] });
  return { restaurantId, tableId: table.id, userId: user.id, order };
}

async function rejectsWith(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (err) => err instanceof HttpError && err.statusCode === status);
}

test('cobrar no borra los pedidos: quedan PAID, vinculados a la venta y con sus ítems', async () => {
  const { restaurantId, tableId, order } = await setup();
  const first = await order(1, 2);
  const second = await order(2);

  const sale = await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 27000 });

  const orders = await prisma.order.findMany({ where: { tableId }, include: { items: true }, orderBy: { id: 'asc' } });
  assert.deepEqual(orders.map(o => o.id), [first.id, second.id]);
  for (const o of orders) {
    assert.equal(o.status, OrderStatus.PAID);
    assert.equal(o.saleId, sale.id);
    assert.ok(o.closedAt);
    assert.equal(o.items.length, 1);
  }
  const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
  assert.equal(table.status, TableStatus.AVAILABLE);
});

test('los pedidos cobrados no vuelven a la cuenta: la próxima mesa arranca de cero', async () => {
  const { restaurantId, tableId, order } = await setup();
  await order(1, 2);
  await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 9000 });

  assert.equal(await ordersService.getTableTotal(restaurantId, tableId), 0);
  assert.deepEqual(await ordersService.list(restaurantId, { tableId }), []);

  // Clientes nuevos en la misma mesa: solo cuenta lo nuevo
  await order(1, 3);
  assert.equal(await ordersService.getTableTotal(restaurantId, tableId), 9000);
  const sale = await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 9000 });
  assert.equal(sale.total.toString(), '9000');
  assert.equal(await prisma.saleItem.count({ where: { saleId: sale.id } }), 1);
});

test('anular un pedido lo marca CANCELLED con motivo y quién; deja de sumar', async () => {
  const { restaurantId, tableId, userId, order } = await setup();
  await order(1, 2);
  const wrong = await order(3);

  await ordersService.cancel(restaurantId, wrong.id, { reason: 'Se cargó en la mesa equivocada', cancelledById: userId });

  const saved = await prisma.order.findUniqueOrThrow({ where: { id: wrong.id }, include: { items: true } });
  assert.equal(saved.status, OrderStatus.CANCELLED);
  assert.equal(saved.cancelReason, 'Se cargó en la mesa equivocada');
  assert.equal(saved.cancelledById, userId);
  assert.ok(saved.closedAt);
  assert.equal(saved.items.length, 1); // los ítems se conservan

  assert.equal(await ordersService.getTableTotal(restaurantId, tableId), 9000);
  const sale = await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 9000 });
  assert.equal(sale.total.toString(), '9000');
  // El anulado no se pasa a PAID ni se vincula a la venta
  const after = await prisma.order.findUniqueOrThrow({ where: { id: wrong.id } });
  assert.equal(after.status, OrderStatus.CANCELLED);
  assert.equal(after.saleId, null);
});

test('no se anula dos veces, ni un pedido ya cobrado, ni sin motivo', async () => {
  const { restaurantId, tableId, userId, order } = await setup();
  const a = await order(1, 2);
  const b = await order(1);
  await ordersService.cancel(restaurantId, b.id, { reason: 'error', cancelledById: userId });
  await rejectsWith(ordersService.cancel(restaurantId, b.id, { reason: 'otra vez', cancelledById: userId }), 409);
  await rejectsWith(ordersService.cancel(restaurantId, a.id, { reason: '   ', cancelledById: userId }), 400);

  await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 9000 });
  await rejectsWith(ordersService.cancel(restaurantId, a.id, { reason: 'tarde', cancelledById: userId }), 409);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).status, OrderStatus.PAID);
});

test('liberar la mesa: se puede si solo quedan pedidos anulados o cobrados', async () => {
  const { restaurantId, tableId, userId, order } = await setup();
  const only = await order(1, 2);
  await rejectsWith(tablesService.close(restaurantId, tableId), 409);

  await ordersService.cancel(restaurantId, only.id, { reason: 'El cliente se fue sin pedir', cancelledById: userId });
  const table = await tablesService.close(restaurantId, tableId);
  assert.equal(table.status, TableStatus.AVAILABLE);
  assert.equal(await prisma.order.count({ where: { tableId } }), 1); // queda en el historial
});

test('cobros simultáneos: una sola venta y los pedidos quedan vinculados a esa', async () => {
  const { restaurantId, tableId, order } = await setup();
  await order(1, 2);
  const results = await Promise.allSettled([
    salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 9000 }),
    salesService.create(restaurantId, { tableId, paymentMethod: 'CARD', amount: 9000 }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const sales = await prisma.sale.findMany({ where: { restaurantId } });
  assert.equal(sales.length, 1);
  const orders = await prisma.order.findMany({ where: { tableId } });
  assert.ok(orders.every(o => o.status === OrderStatus.PAID && o.saleId === sales[0].id));
});

test('una mesa con historial de pedidos no se borra (se deshabilita)', async () => {
  const { restaurantId, tableId, order } = await setup();
  await order(1, 2);
  await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 9000 });
  await rejectsWith(tablesService.remove(restaurantId, tableId), 409);
  assert.equal(await prisma.order.count({ where: { tableId } }), 1);
});
