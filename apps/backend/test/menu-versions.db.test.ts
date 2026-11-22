// ──────────────────────────────────────────────
// Versión grande de un plato: reglas del vínculo y pedido con precio y título propios.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { menuService } from '../src/modules/menu/menu.service.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { printingService } from '../src/modules/printing/printing.service.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
after(async () => { await prisma.restaurant.deleteMany(); await prisma.$disconnect(); httpServer.close(); });
beforeEach(async () => { await prisma.restaurant.deleteMany(); });

const isHttp = (status: number) => (err: unknown) => err instanceof HttpError && err.statusCode === status;

async function setup(name = 'El Molino') {
  const r = (await prisma.restaurant.create({ data: { name } })).id;
  await prisma.menuCategory.createMany({ data: [
    { restaurantId: r, name: 'Entradas', order: 0 },
    { restaurantId: r, name: 'Principales', order: 1 },
  ] });
  const dish = (n: string, category: string, price: string) =>
    prisma.menuItem.create({ data: { restaurantId: r, name: n, category, price } });
  return {
    r,
    base: await dish('Ensalada César', 'Entradas', '8000.00'),
    large: await dish('Ensalada César grande', 'Principales', '15000.00'),
    other: await dish('Caprese', 'Entradas', '7000.00'),
  };
}

test('vincular, desvincular y dejarlo en la auditoría', async () => {
  const { r, base, large } = await setup();
  assert.equal((await menuService.update(r, base.id, { largeVersionId: large.id })).largeVersionId, large.id);
  assert.equal(await prisma.auditLog.count({ where: { restaurantId: r, action: 'menu.large_version' } }), 1);

  // Editar otra cosa del plato no toca el vínculo ni suma auditoría
  assert.equal((await menuService.update(r, base.id, { name: 'César', largeVersionId: large.id })).largeVersionId, large.id);
  assert.equal(await prisma.auditLog.count({ where: { restaurantId: r, action: 'menu.large_version' } }), 1);

  assert.equal((await menuService.update(r, base.id, { largeVersionId: null })).largeVersionId, null);
  assert.equal(await prisma.auditLog.count({ where: { restaurantId: r, action: 'menu.large_version' } }), 2);
});

test('reglas: ni a sí mismo, ni en cadena, ni compartida, ni de otro restaurante', async () => {
  const a = await setup();
  const b = await setup('Otro local');
  await assert.rejects(menuService.update(a.r, a.base.id, { largeVersionId: a.base.id }), isHttp(400));
  await assert.rejects(menuService.update(a.r, a.base.id, { largeVersionId: b.large.id }), isHttp(400));

  await menuService.update(a.r, a.base.id, { largeVersionId: a.large.id });
  await assert.rejects(menuService.update(a.r, a.other.id, { largeVersionId: a.large.id }), isHttp(409));
  await assert.rejects(menuService.update(a.r, a.large.id, { largeVersionId: a.other.id }), isHttp(400));
  await assert.rejects(menuService.update(a.r, a.other.id, { largeVersionId: a.base.id }), isHttp(400));
});

test('borrar la versión grande deja el plato base funcionando', async () => {
  const { r, base, large } = await setup();
  await menuService.update(r, base.id, { largeVersionId: large.id });
  await menuService.remove(r, large.id);
  assert.equal((await menuService.getById(r, base.id)).largeVersionId, null);
});

test('la versión grande se cobra a su precio y sale bajo su título en la comanda', async () => {
  const { r, base, large } = await setup();
  await menuService.update(r, base.id, { largeVersionId: large.id });
  const table = await prisma.table.create({ data: { restaurantId: r, number: 1 } });
  const order = await ordersService.create(r, { tableId: table.id, guestCount: 2, items: [
    { menuItemId: base.id, quantity: 1 }, { menuItemId: large.id, quantity: 1 },
  ] });
  assert.deepEqual(order.items.map(i => Number(i.price)).sort((x, y) => x - y), [8000, 15000]);
  assert.equal(await ordersService.getTableTotal(r, table.id), 23000);

  const job = await printingService.printOrder({ restaurantId: r, orderId: order.id });
  assert.ok(job);
  const t = job.doc.lines.map(l => l.text);
  assert.ok(t.indexOf('ENTRADAS') < t.indexOf('1x Ensalada César'));
  assert.ok(t.indexOf('PRINCIPALES') > t.indexOf('1x Ensalada César'));
  assert.ok(t.indexOf('PRINCIPALES') < t.indexOf('1x Ensalada César grande'));
});
