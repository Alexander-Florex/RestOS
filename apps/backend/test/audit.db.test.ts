// ──────────────────────────────────────────────
// audit.db.test.ts — Registro de auditoría (tarea 1.2)
// Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { prisma } from '../src/lib/prisma.js';
import { buildApp } from '../src/server.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { runWithContext } from '../src/lib/request-context.js';
import { loginLimiter } from '../src/lib/login-limiter.js';
import { invalidateAccess, rolesService } from '../src/modules/roles/roles.service.js';
import { usersService } from '../src/modules/users/users.service.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { menuService } from '../src/modules/menu/menu.service.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';
import { takeawayService } from '../src/modules/takeaway/takeaway.service.js';

const server = http.createServer(buildApp());
let base = '';
before(async () => {
  initSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  server.close();
});
beforeEach(async () => {
  await prisma.restaurant.deleteMany();
  invalidateAccess();
  loginLimiter.reset();
});

async function setup() {
  const restaurant = await prisma.restaurant.create({ data: { name: 'Test' } });
  const restaurantId = restaurant.id;
  const roles = await rolesService.ensureSystemRoles(restaurantId);
  const admin = await usersService.create(restaurantId, {
    username: 'admin', email: 'admin@x', password: 'clave-admin', name: 'Ana Admin', roleId: roles.ADMIN.id,
  });
  const cajero = await usersService.create(restaurantId, {
    username: 'caja', email: 'caja@x', password: 'clave-caja', name: 'Carlos Caja', roleId: roles.CASHIER.id,
  });
  const table = await prisma.table.create({ data: { restaurantId, number: 7, capacity: 4 } });
  const dish = await prisma.menuItem.create({ data: { restaurantId, name: 'Milanesa', category: 'mains', price: '9000.00' } });
  await prisma.auditLog.deleteMany({ where: { restaurantId } }); // las altas de arriba no interesan acá
  return { restaurantId, roles, admin, cajero, tableId: table.id, dish };
}

const logs = (restaurantId: number, action?: string) =>
  prisma.auditLog.findMany({ where: { restaurantId, ...(action ? { action } : {}) }, orderBy: { id: 'asc' } });

test('cobro de mesa: queda quién cobró, total, medio y pedidos; un cobro rechazado no deja registro', async () => {
  const { restaurantId, tableId, dish, cajero } = await setup();
  const order = await ordersService.create(restaurantId, { tableId, guestCount: 2, items: [{ menuItemId: dish.id, quantity: 2 }] });

  await assert.rejects(salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 100, registeredById: cajero.id }));
  assert.equal((await logs(restaurantId, 'sale.create')).length, 0);

  const sale = await salesService.create(restaurantId, { tableId, paymentMethod: 'CARD', amount: 18000, registeredById: cajero.id });
  const [entry] = await logs(restaurantId, 'sale.create');
  assert.equal(entry.entityId, sale.id);
  assert.equal(entry.userId, cajero.id);
  assert.equal(entry.userName, 'Carlos Caja');
  const data = entry.after as Record<string, unknown>;
  assert.equal(data.total, '18000');
  assert.equal(data.paymentMethod, 'CARD');
  assert.equal(data.tableNumber, 7);
  assert.deepEqual(data.orderIds, [order.id]);
});

test('anular pedido: motivo, ítems y total anulados', async () => {
  const { restaurantId, tableId, dish, cajero } = await setup();
  const order = await ordersService.create(restaurantId, { tableId, guestCount: 2, items: [{ menuItemId: dish.id, quantity: 3 }] });
  await ordersService.cancel(restaurantId, order.id, { reason: 'Mesa equivocada', cancelledById: cajero.id });

  const [entry] = await logs(restaurantId, 'order.cancel');
  assert.equal(entry.reason, 'Mesa equivocada');
  assert.equal(entry.userName, 'Carlos Caja');
  const before = entry.before as { total: number; items: Array<{ itemName: string; quantity: number }> };
  assert.equal(before.total, 27000);
  assert.deepEqual(before.items.map(i => [i.itemName, i.quantity]), [['Milanesa', 3]]);
});

test('precio del plato: se registra el cambio (y el usuario sale del pedido en curso); sin cambio, nada', async () => {
  const { restaurantId, dish, admin } = await setup();
  await runWithContext({ userId: admin.id, restaurantId }, () =>
    menuService.update(restaurantId, dish.id, { name: 'Milanesa napolitana' }));
  assert.equal((await logs(restaurantId, 'menu.price')).length, 0);

  await runWithContext({ userId: admin.id, restaurantId }, () =>
    menuService.update(restaurantId, dish.id, { price: 9900 }));
  const [entry] = await logs(restaurantId, 'menu.price');
  assert.equal(entry.userId, admin.id);
  assert.deepEqual(entry.before, { name: 'Milanesa napolitana', price: '9000' });
  assert.deepEqual(entry.after, { name: 'Milanesa napolitana', price: '9900' });
});

test('opciones del plato: el cambio de recargos queda registrado', async () => {
  const { restaurantId, dish } = await setup();
  await menuService.saveOptions(restaurantId, dish.id, [
    { name: 'Agregados', type: 'MULTI', required: false, options: [{ name: 'Huevo', priceDelta: 700, isDefault: false }] },
  ]);
  const [entry] = await logs(restaurantId, 'menu.options');
  const after = entry.after as { groups: Array<{ options: Array<{ name: string; priceDelta: string }> }> };
  assert.deepEqual(after.groups[0].options, [{ name: 'Huevo', priceDelta: '700', isDefault: false }]);
  // Guardar lo mismo otra vez no agrega ruido
  const saved = await menuService.getById(restaurantId, dish.id);
  await menuService.saveOptions(restaurantId, dish.id, saved.optionGroups.map(g => ({
    id: g.id, name: g.name, type: g.type, required: g.required,
    options: g.options.map(o => ({ id: o.id, name: o.name, priceDelta: Number(o.priceDelta), isDefault: o.isDefault })),
  })));
  assert.equal((await logs(restaurantId, 'menu.options')).length, 1);
});

test('stock: reposición y consumo con cantidades; un consumo rechazado no deja registro', async () => {
  const { restaurantId } = await setup();
  const item = await inventoryService.create(restaurantId, { name: 'Harina', quantity: 10, unit: 'kg' });
  await inventoryService.restock(restaurantId, item.id, 5);
  await inventoryService.consume(restaurantId, item.id, 3);
  await assert.rejects(inventoryService.consume(restaurantId, item.id, 999), (e) => e instanceof HttpError && e.statusCode === 400);

  const entries = (await logs(restaurantId)).filter(l => l.action.startsWith('inventory.'));
  assert.deepEqual(entries.map(e => [e.action, (e.before as { quantity: number }).quantity, (e.after as { quantity: number }).quantity]), [
    ['inventory.restock', 10, 15],
    ['inventory.consume', 15, 12],
  ]);
});

test('para llevar: cobro y cancelación', async () => {
  const { restaurantId, dish, cajero } = await setup();
  const paid = await takeawayService.create(restaurantId, { customerName: 'Ana', items: [{ menuItemId: dish.id, quantity: 1 }] });
  await takeawayService.pay(restaurantId, paid.id, 'CASH', 10000, { registeredById: cajero.id });
  const cancelled = await takeawayService.create(restaurantId, { customerName: 'Beto', items: [{ menuItemId: dish.id, quantity: 1 }] });
  await runWithContext({ userId: cajero.id, restaurantId }, () => takeawayService.cancel(restaurantId, cancelled.id));

  const [pay] = await logs(restaurantId, 'takeaway.pay');
  assert.equal((pay.after as { customerName: string }).customerName, 'Ana');
  assert.equal(pay.userId, cajero.id);
  const [cancel] = await logs(restaurantId, 'takeaway.cancel');
  assert.equal(cancel.entityId, cancelled.id);
  assert.equal(cancel.userName, 'Carlos Caja');
});

test('usuarios: nunca se guarda la contraseña; el nombre queda aunque se borre la cuenta', async () => {
  const { restaurantId, roles, admin } = await setup();
  const ctx = { userId: admin.id, restaurantId };
  const mozo = await runWithContext(ctx, () => usersService.create(restaurantId, {
    username: 'mozo', email: 'mozo@x', password: 'secreto-del-mozo', name: 'Mario Mozo', roleId: roles.WAITER.id,
  }));
  await runWithContext(ctx, () => usersService.update(restaurantId, mozo.id, admin.id, { password: 'otra-clave-nueva', roleId: roles.CASHIER.id }));
  await runWithContext(ctx, () => usersService.toggleActive(restaurantId, mozo.id, admin.id));
  await runWithContext(ctx, () => usersService.remove(restaurantId, mozo.id, admin.id));

  const entries = (await logs(restaurantId)).filter(l => l.action.startsWith('user.'));
  assert.deepEqual(entries.map(e => e.action), ['user.create', 'user.update', 'user.toggle', 'user.delete']);
  const all = JSON.stringify(entries);
  assert.ok(!all.includes('secreto-del-mozo') && !all.includes('otra-clave-nueva') && !all.includes('$2'), 'ninguna contraseña ni hash');
  const update = entries[1];
  assert.deepEqual(update.after, { username: 'mozo', role: 'Cajero', cambioDeClave: true });
  assert.ok(entries.every(e => e.userName === 'Ana Admin'));
  // Borrar al autor no borra el registro: queda el nombre
  await prisma.user.update({ where: { id: admin.id }, data: { active: true } });
  assert.equal((await logs(restaurantId)).length, entries.length);
});

test('API: solo con audit.view (Administrador); el Cajero recibe 403', async () => {
  const { restaurantId, tableId, dish, cajero } = await setup();
  await ordersService.create(restaurantId, { tableId, guestCount: 2, items: [{ menuItemId: dish.id, quantity: 1 }] });
  await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 9000, registeredById: cajero.id });

  const login = async (username: string, password: string) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ restaurantId, username, password }),
    });
    return ((await res.json()) as { token: string }).token;
  };
  const adminToken = await login('admin', 'clave-admin');
  const cajaToken = await login('caja', 'clave-caja');

  assert.equal((await fetch(`${base}/api/audit`, { headers: { Authorization: `Bearer ${cajaToken}` } })).status, 403);
  const res = await fetch(`${base}/api/audit?action=sale`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { total: number; entries: Array<{ action: string; userName: string }> };
  assert.equal(body.total, 1);
  assert.equal(body.entries[0].userName, 'Carlos Caja');

  // Una acción hecha por HTTP toma el usuario del token (sin pasarlo a mano)
  await fetch(`${base}/api/menu/${dish.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: 9500 }),
  });
  const [price] = await logs(restaurantId, 'menu.price');
  assert.equal(price.userName, 'Ana Admin');
});
