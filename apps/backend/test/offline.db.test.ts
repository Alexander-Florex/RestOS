// ──────────────────────────────────────────────
// offline.db.test.ts — Pedidos reintentados tras un corte (tarea 1.5):
// el mismo clientRequestId nunca crea dos pedidos.
// Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { takeawayService } from '../src/modules/takeaway/takeaway.service.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
after(async () => {
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  httpServer.close();
});
beforeEach(async () => { await prisma.restaurant.deleteMany(); });

async function setup(name = 'Test') {
  const restaurant = await prisma.restaurant.create({ data: { name } });
  const table = await prisma.table.create({ data: { restaurantId: restaurant.id, number: 1, capacity: 4 } });
  const dish = await prisma.menuItem.create({ data: { restaurantId: restaurant.id, name: 'Empanada', category: 'x', price: '1500.00' } });
  return { restaurantId: restaurant.id, tableId: table.id, menuItemId: dish.id };
}

test('mesa: reenviar el mismo pedido devuelve el ya creado (no duplica ni suma)', async () => {
  const { restaurantId, tableId, menuItemId } = await setup();
  const body = { tableId, guestCount: 2, items: [{ menuItemId, quantity: 2 }], clientRequestId: 'disp-1-abcdef12' };

  const first = await ordersService.create(restaurantId, body);
  const retry = await ordersService.create(restaurantId, body);

  assert.equal(retry.id, first.id);
  assert.equal(await prisma.order.count({ where: { tableId } }), 1);
  assert.equal(await ordersService.getTableTotal(restaurantId, tableId), 3000);
});

test('mesa: dos envíos simultáneos del mismo pedido crean uno solo', async () => {
  const { restaurantId, tableId, menuItemId } = await setup();
  const body = { tableId, guestCount: 2, items: [{ menuItemId, quantity: 1 }], clientRequestId: 'disp-2-abcdef12' };

  const results = await Promise.all([1, 2, 3].map(() => ordersService.create(restaurantId, body)));

  assert.equal(new Set(results.map(o => o.id)).size, 1);
  assert.equal(await prisma.order.count({ where: { tableId } }), 1);
});

test('el mismo id en otro restaurante es otro pedido; sin id, cada envío es un pedido', async () => {
  const a = await setup('A');
  const b = await setup('B');
  const id = 'disp-3-abcdef12';
  const oa = await ordersService.create(a.restaurantId, { tableId: a.tableId, guestCount: 1, items: [{ menuItemId: a.menuItemId, quantity: 1 }], clientRequestId: id });
  const ob = await ordersService.create(b.restaurantId, { tableId: b.tableId, guestCount: 1, items: [{ menuItemId: b.menuItemId, quantity: 1 }], clientRequestId: id });
  assert.notEqual(oa.id, ob.id);

  await ordersService.create(a.restaurantId, { tableId: a.tableId, items: [{ menuItemId: a.menuItemId, quantity: 1 }] });
  await ordersService.create(a.restaurantId, { tableId: a.tableId, items: [{ menuItemId: a.menuItemId, quantity: 1 }] });
  assert.equal(await prisma.order.count({ where: { tableId: a.tableId } }), 3);
});

test('para llevar: reintentos y envíos simultáneos con el mismo id crean uno solo', async () => {
  const { restaurantId, menuItemId } = await setup();
  const body = { customerName: 'Ana', items: [{ menuItemId, quantity: 1 }], clientRequestId: 'disp-4-abcdef12' };
  const results = await Promise.all([1, 2].map(() => takeawayService.create(restaurantId, body)));
  const retry = await takeawayService.create(restaurantId, body);
  assert.equal(new Set([...results, retry].map(o => o.id)).size, 1);
  assert.equal(await prisma.takeawayOrder.count({ where: { restaurantId } }), 1);
});
