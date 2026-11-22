// ──────────────────────────────────────────────
// Pedido del cliente: la Caja no ve lo facturado, y "Ver pedido de la mesa" se
// activa o desactiva por rol. Se prueba contra las rutas reales, no solo la pantalla.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { buildApp } from '../src/server.js';
import { signToken } from '../src/lib/jwt.js';
import { invalidateAccess, rolesService } from '../src/modules/roles/roles.service.js';
import { usersService } from '../src/modules/users/users.service.js';
import { ordersService } from '../src/modules/orders/orders.service.js';

const server = http.createServer(buildApp());
let base = '';
before(async () => {
  initSocket(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  await new Promise(resolve => server.close(resolve));
});
beforeEach(async () => { await prisma.restaurant.deleteMany(); invalidateAccess(); });

async function setup() {
  const restaurantId = (await prisma.restaurant.create({ data: { name: 'Test' } })).id;
  const roles = await rolesService.ensureSystemRoles(restaurantId);
  const person = async (username: string, roleId: number, role: 'ADMIN' | 'WAITER' | 'STAFF') => {
    const u = await usersService.create(restaurantId, { username, email: `${username}@test.local`, password: '1234', name: username, roleId });
    return signToken({ userId: u.id, restaurantId, username, role });
  };
  const admin = await person('admin', roles.ADMIN.id, 'ADMIN');
  const caja = await person('caja', roles.CASHIER.id, 'STAFF');
  const mozo = await person('mozo', roles.WAITER.id, 'WAITER');
  const dish = await prisma.menuItem.create({ data: { restaurantId, name: 'Bife', category: 'Principales', price: '1000.00' } });
  const table = await prisma.table.create({ data: { restaurantId, number: 1 } });
  const order = await ordersService.create(restaurantId, { tableId: table.id, guestCount: 2, items: [{ menuItemId: dish.id, quantity: 1 }] });
  return { restaurantId, roles, admin, caja, mozo, dish, table, order };
}

const get = (path: string, token: string) => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.status);

const BILLING_ROUTES = [
  '/sales', '/sales/stats/daily', '/reports/sales?from=2026-11-01&to=2026-11-02', '/reports/top-items',
  '/reports/tickets', '/reports/sales.csv', '/reports/profitability', '/reports/owner', '/reports/daily-close',
];

test('la Caja no puede leer ventas, reportes ni análisis, aunque llame a la API directo', async () => {
  const { caja } = await setup();
  for (const path of BILLING_ROUTES) assert.equal(await get(path, caja), 403, path);
});

test('la Caja no abre el detalle de una venta; sí puede cobrar, ver la mesa y usar la caja', async () => {
  const { restaurantId, caja, table } = await setup();
  assert.equal(await get(`/orders/table/${table.id}`, caja), 200);
  assert.equal(await get('/cash/current', caja), 200);
  const res = await fetch(`${base}/sales`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${caja}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId: table.id, paymentMethod: 'CASH', amount: 1000 }),
  });
  assert.equal(res.status, 201);
  const sale = await prisma.sale.findFirstOrThrow({ where: { restaurantId } });
  assert.equal(await get(`/sales/${sale.id}/detail`, caja), 403);
});

test('el Administrador sigue viendo ventas y reportes', async () => {
  const { admin } = await setup();
  assert.equal(await get('/sales', admin), 200);
  assert.equal(await get('/sales/stats/daily', admin), 200);
});

test('el Mesero ve el pedido; si le sacan el permiso no lo ve, pero sigue tomando pedidos', async () => {
  const { roles, mozo, dish, table, order } = await setup();
  assert.equal(await get(`/orders/table/${table.id}`, mozo), 200);
  assert.equal(await get(`/orders/${order.id}`, mozo), 200);

  await prisma.role.update({ where: { id: roles.WAITER.id }, data: { permissions: ['orders.create'] } });
  invalidateAccess();
  assert.equal(await get(`/orders/table/${table.id}`, mozo), 403);
  assert.equal(await get(`/orders/${order.id}`, mozo), 403);
  const res = await fetch(`${base}/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${mozo}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tableId: table.id, items: [{ menuItemId: dish.id, quantity: 1 }] }),
  });
  assert.equal(res.status, 201);
});

test('la migración cambia solo lo pedido y se puede repetir sin efecto', async () => {
  const restaurantId = (await prisma.restaurant.create({ data: { name: 'Vieja' } })).id;
  const create = (name: string, key: string | null, permissions: string[]) =>
    prisma.role.create({ data: { restaurantId, name, key, permissions } });
  const waiter = await create('Mesero', 'WAITER', ['orders.create']);
  const cashier = await create('Cajero', 'CASHIER', ['app.dashboard', 'orders.create', 'sales.charge', 'sales.view', 'reports.view', 'cash.manage']);
  const manager = await create('Encargado', null, ['app.dashboard', 'orders.create', 'sales.view', 'reports.view']);
  const viewer = await create('Solo reportes', null, ['app.dashboard', 'reports.view']);

  const sql = await readFile(new URL('../prisma/migrations/20261122120000_table_orders_permission_cashier_privacy/migration.sql', import.meta.url), 'utf8');
  const statements = sql.split('\n').filter(l => !l.startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean);
  for (let run = 0; run < 2; run++) for (const s of statements) await prisma.$executeRawUnsafe(s);

  const perms = async (id: number) => ((await prisma.role.findUniqueOrThrow({ where: { id } })).permissions as string[]).slice().sort();
  assert.deepEqual(await perms(waiter.id), ['orders.create', 'orders.table']);
  assert.deepEqual(await perms(cashier.id), ['app.dashboard', 'cash.manage', 'orders.create', 'orders.table', 'sales.charge']);
  // Un rol propio conserva lo que ve: solo suma el pedido de la mesa si toma pedidos
  assert.deepEqual(await perms(manager.id), ['app.dashboard', 'orders.create', 'orders.table', 'reports.view', 'sales.view']);
  assert.deepEqual(await perms(viewer.id), ['app.dashboard', 'reports.view']);
});
