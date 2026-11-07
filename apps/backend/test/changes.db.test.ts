// ──────────────────────────────────────────────
// changes.db.test.ts — Cambiar o rehacer platos (tarea 5.8)
// Regla del cliente: se cobra solo lo que se consume; lo tirado es pérdida.
// Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ItemChangeStatus, OrderItemStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { orderChangesService } from '../src/modules/orders/order-changes.service.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { menuService } from '../src/modules/menu/menu.service.js';

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
  const table = await prisma.table.create({ data: { restaurantId, number: 5, capacity: 4 } });
  const cesar = await prisma.menuItem.create({ data: { restaurantId, name: 'Ensalada César', category: 'x', price: '8000.00' } });
  const mila = await prisma.menuItem.create({ data: { restaurantId, name: 'Milanesa', category: 'x', price: '9500.00' } });
  const order = await ordersService.create(restaurantId, {
    tableId: table.id, guestCount: 2, items: [{ menuItemId: cesar.id, quantity: 2 }],
  });
  return { restaurantId, tableId: table.id, cesar, mila, order, itemId: order.items[0].id };
}

async function rejectsWith(promise: Promise<unknown>, status: number, re?: RegExp) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof HttpError, String(err));
    assert.equal(err.statusCode, status, err.message);
    if (re) assert.match(err.message, re);
    return true;
  });
}

const replaceBody = (menuItemId: number, quantity = 1, extra: Partial<{ wasPrepared: boolean; reason: string }> = {}) => ({
  quantity, reason: extra.reason ?? 'El cliente se arrepintió', fault: 'CUSTOMER' as const,
  wasPrepared: extra.wasPrepared ?? false, replacement: { menuItemId },
});

test('rehacer: se cobra una sola vez, queda como pérdida con motivo', async () => {
  const { restaurantId, tableId, itemId } = await setup();
  const change = await orderChangesService.remake(restaurantId, itemId, { quantity: 1, reason: 'Salió frío', fault: 'KITCHEN' });

  assert.equal(change.type, 'REMAKE');
  assert.equal(change.status, ItemChangeStatus.APPLIED);
  assert.equal(change.wasPrepared, true);
  assert.equal(await ordersService.getTableTotal(restaurantId, tableId), 16000);
  const log = await prisma.auditLog.findFirstOrThrow({ where: { restaurantId, action: 'order.item.remake' } });
  assert.equal(log.reason, 'Salió frío');
  assert.equal((log.after as { lostValue: number }).lostValue, 8000);

  await rejectsWith(orderChangesService.remake(restaurantId, itemId, { quantity: 3, reason: 'x x x' }), 400);
  await rejectsWith(orderChangesService.remake(restaurantId, itemId, { quantity: 1, reason: '  ' }), 400, /motivo/);
});

test('cambiar con autorización: el original no se cobra, se cobra el nuevo; separa unidades', async () => {
  const { restaurantId, tableId, itemId, mila } = await setup();
  const change = await orderChangesService.replace(restaurantId, itemId, replaceBody(mila.id, 1, { wasPrepared: true }), true);
  assert.equal(change.status, ItemChangeStatus.APPLIED);

  const items = await prisma.orderItem.findMany({ where: { orderId: change.orderId }, orderBy: { id: 'asc' } });
  const lines = items.map(i => [i.itemName, i.quantity, i.status]);
  assert.deepEqual(lines, [
    ['Ensalada César', 1, OrderItemStatus.ACTIVE],   // la otra César sigue
    ['Ensalada César', 1, OrderItemStatus.VOIDED],   // la cambiada (ya hecha: pérdida)
    ['Milanesa', 1, OrderItemStatus.ACTIVE],         // el reemplazo
  ]);
  assert.match(items[1].voidReason ?? '', /ya estaba hecho/);

  // Cuenta: 8000 (César) + 9500 (Milanesa); la César cambiada no se cobra
  assert.equal(await ordersService.getTableTotal(restaurantId, tableId), 17500);
  const sale = await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 17500 });
  assert.equal(sale.total.toString(), '17500');
  const saleItems = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
  assert.deepEqual(saleItems.map(i => [i.itemName, i.quantity]).sort(), [['Ensalada César', 1], ['Milanesa', 1]]);
});

test('el mozo pide el cambio: queda pendiente hasta que caja lo aprueba', async () => {
  const { restaurantId, tableId, itemId, mila } = await setup();
  const pending = await orderChangesService.replace(restaurantId, itemId, replaceBody(mila.id, 2), false);
  assert.equal(pending.status, ItemChangeStatus.PENDING);
  assert.equal(await ordersService.getTableTotal(restaurantId, tableId), 16000); // nada cambió todavía

  const list = await orderChangesService.list(restaurantId, { status: ItemChangeStatus.PENDING });
  assert.deepEqual(list.map(c => c.id), [pending.id]);

  const approved = await orderChangesService.approve(restaurantId, pending.id, null);
  assert.equal(approved.status, ItemChangeStatus.APPLIED);
  assert.equal(await ordersService.getTableTotal(restaurantId, tableId), 19000);
  await rejectsWith(orderChangesService.approve(restaurantId, pending.id, null), 409);
});

test('caja rechaza el cambio: el plato sigue igual', async () => {
  const { restaurantId, tableId, itemId, mila } = await setup();
  const pending = await orderChangesService.replace(restaurantId, itemId, replaceBody(mila.id), false);
  const rejected = await orderChangesService.reject(restaurantId, pending.id, null, 'Ya salió de cocina');
  assert.equal(rejected.status, ItemChangeStatus.REJECTED);
  assert.equal(rejected.rejectReason, 'Ya salió de cocina');
  assert.equal(await ordersService.getTableTotal(restaurantId, tableId), 16000);
  await rejectsWith(orderChangesService.approve(restaurantId, pending.id, null), 409);
});

test('al cobrar la mesa, los cambios pendientes se cierran y ya no se pueden aprobar', async () => {
  const { restaurantId, tableId, itemId, mila } = await setup();
  const pending = await orderChangesService.replace(restaurantId, itemId, replaceBody(mila.id), false);
  await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 16000 });

  const saved = await prisma.orderItemChange.findUniqueOrThrow({ where: { id: pending.id } });
  assert.equal(saved.status, ItemChangeStatus.REJECTED);
  await rejectsWith(orderChangesService.approve(restaurantId, pending.id, null), 409);
});

test('no se cambia un plato ya cambiado, ni por uno sin stock', async () => {
  const { restaurantId, itemId, mila, cesar } = await setup();
  await menuService.setStock(restaurantId, mila.id, 'OUT_OF_STOCK');
  await rejectsWith(orderChangesService.replace(restaurantId, itemId, replaceBody(mila.id), true), 400, /sin stock/);

  const other = await prisma.menuItem.create({ data: { restaurantId, name: 'Tarta', category: 'x', price: '7000.00' } });
  await orderChangesService.replace(restaurantId, itemId, replaceBody(other.id, 2), true);
  await rejectsWith(orderChangesService.replace(restaurantId, itemId, replaceBody(cesar.id), true), 409, /ya fue cambiado/);
});

test('aprobar un cambio mientras se cobra: o entra en la cuenta, o el cambio se rechaza', async () => {
  for (let i = 0; i < 5; i++) {
    await prisma.restaurant.deleteMany();
    const { restaurantId, tableId, itemId, mila } = await setup();
    const pending = await orderChangesService.replace(restaurantId, itemId, replaceBody(mila.id), false);
    const [sale, approval] = await Promise.allSettled([
      salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 20000 }),
      orderChangesService.approve(restaurantId, pending.id, null),
    ]);
    assert.equal(sale.status, 'fulfilled', `iteración ${i}`);
    const saved = await prisma.sale.findFirstOrThrow({ where: { restaurantId } });
    if (approval.status === 'fulfilled') {
      assert.equal(saved.total.toString(), '17500', `iteración ${i}: el cambio entró antes del cobro`);
    } else {
      assert.equal(saved.total.toString(), '16000', `iteración ${i}: el cobro ganó y el cambio quedó afuera`);
    }
  }
});
