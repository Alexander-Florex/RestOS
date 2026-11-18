// ──────────────────────────────────────────────
// Mesas con nombre: nombre único por restaurante, opción "por nombre / por número"
// y copia del nombre en la venta.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { tablesService, getTableLabelMode } from '../src/modules/tables/tables.service.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { tableLabel, tablesLabel, normalizeTableName } from '../src/shared/table-label.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
after(async () => {
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  httpServer.close();
});
beforeEach(async () => { await prisma.restaurant.deleteMany(); });

const isHttp = (status: number) => (err: unknown) => err instanceof HttpError && err.statusCode === status;

async function restaurant() {
  return (await prisma.restaurant.create({ data: { name: 'Test' } })).id;
}

test('etiqueta: por nombre si tiene, si no "Mesa N"; por número siempre el número', () => {
  assert.equal(tableLabel({ number: 3, name: 'Ventana' }), 'Ventana');
  assert.equal(tableLabel({ number: 3, name: null }), 'Mesa 3');
  assert.equal(tableLabel({ number: 3, name: '   ' }), 'Mesa 3');
  assert.equal(tableLabel({ number: 3, name: 'Ventana' }, 'NUMBER'), 'Mesa 3');
  assert.equal(tablesLabel([{ number: 2, name: 'Patio' }, { number: 1, name: 'Ventana' }]), 'Ventana + Patio');
  assert.equal(normalizeTableName('  Mesa   de  ventana '), 'Mesa de ventana');
  assert.equal(normalizeTableName('   '), null);
});

test('crea y renombra mesas; el nombre no se repite (sin distinguir mayúsculas)', async () => {
  const r = await restaurant();
  const a = await tablesService.create(r, { number: 1, name: ' Ventana ' });
  assert.equal(a.name, 'Ventana');
  await assert.rejects(tablesService.create(r, { number: 2, name: 'ventana' }), isHttp(409));

  // Varias mesas sin nombre conviven
  await tablesService.create(r, { number: 2 });
  await tablesService.create(r, { number: 3, name: '' });

  const b = await tablesService.update(r, a.id, { name: 'Patio' });
  assert.equal(b.name, 'Patio');
  // Quitarle el nombre
  const c = await tablesService.update(r, a.id, { name: '' });
  assert.equal(c.name, null);

  // Otro restaurante puede usar el mismo nombre
  const r2 = await restaurant();
  await tablesService.create(r2, { number: 1, name: 'Ventana' });
  await tablesService.create(r, { number: 4, name: 'Ventana' });
});

test('por defecto se muestran por nombre; el administrador puede cambiarlo', async () => {
  const r = await restaurant();
  assert.equal(await getTableLabelMode(r), 'NAME');
  await tablesService.setLabelMode(r, 'NUMBER');
  assert.equal(await getTableLabelMode(r), 'NUMBER');
});

test('la venta guarda el nombre que tenía la mesa al cobrar', async () => {
  const r = await restaurant();
  const table = await tablesService.create(r, { number: 7, name: 'Ventana' });
  const dish = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Milanesa', category: 'main', price: '8000.00' } });
  await ordersService.create(r, { tableId: table.id, guestCount: 2, items: [{ menuItemId: dish.id, quantity: 1 }] });

  const sale = await salesService.create(r, { tableId: table.id, paymentMethod: 'CASH', amount: 8000 });
  assert.equal(sale.tableNumber, 7);
  assert.equal(sale.tableName, 'Ventana');

  // Renombrarla después no cambia la venta
  await tablesService.update(r, table.id, { name: 'Barra' });
  const again = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
  assert.equal(again.tableName, 'Ventana');
});

// ──────────────────────────────────────────────
// Mesas unidas (tarea 5.3): cada mesa conserva sus pedidos; se cobran juntas o por separado.
// ──────────────────────────────────────────────
async function salon(names: string[] = ['Ventana', 'Patio', 'Barra']) {
  const r = await restaurant();
  const tables = [];
  for (let i = 0; i < names.length; i++) tables.push(await tablesService.create(r, { number: i + 1, name: names[i] }));
  const dish = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Milanesa', category: 'main', price: '1000.00' } });
  const order = (tableId: number, quantity = 1) =>
    ordersService.create(r, { tableId, guestCount: 2, items: [{ menuItemId: dish.id, quantity }] });
  return { r, t: tables, order };
}
const fresh = (id: number) => prisma.table.findUniqueOrThrow({ where: { id } });

test('unir: las libres se abren, quedan con el mismo grupo y cada una conserva sus pedidos', async () => {
  const { r, t, order } = await salon();
  await order(t[0].id, 2);
  const joined = await tablesService.join(r, t[0].id, [t[1].id]);
  assert.equal(joined.length, 2);
  const [a, b] = [await fresh(t[0].id), await fresh(t[1].id)];
  assert.equal(a.groupId, t[0].id);
  assert.equal(b.groupId, t[0].id);
  assert.equal(b.status, 'OCCUPIED');
  // Se suma una tercera desde cualquiera del grupo
  await tablesService.join(r, t[1].id, [t[2].id]);
  assert.equal((await fresh(t[2].id)).groupId, t[0].id);
  // Los pedidos siguen en su mesa
  assert.equal(await prisma.order.count({ where: { tableId: t[0].id } }), 1);
  assert.equal(await prisma.order.count({ where: { tableId: t[1].id } }), 0);
});

test('unir: no deja unir una reservada, una deshabilitada ni una que está en otro grupo', async () => {
  const { r, t } = await salon(['A', 'B', 'C', 'D']);
  await tablesService.reserve(r, t[2].id);
  await assert.rejects(tablesService.join(r, t[0].id, [t[2].id]), isHttp(400));
  await tablesService.join(r, t[0].id, [t[1].id]);
  await assert.rejects(tablesService.join(r, t[3].id, [t[1].id]), isHttp(409));
  await assert.rejects(tablesService.join(r, t[0].id, []), isHttp(400));
});

test('separar: la que sale conserva sus pedidos; si queda una sola, deja de estar unida', async () => {
  const { r, t, order } = await salon();
  await tablesService.join(r, t[0].id, [t[1].id, t[2].id]);
  await order(t[0].id);
  // Se va la que da nombre al grupo: las otras dos siguen unidas con el id de una de ellas
  await tablesService.separate(r, t[0].id);
  assert.equal((await fresh(t[0].id)).groupId, null);
  assert.equal((await fresh(t[1].id)).groupId, t[1].id);
  assert.equal((await fresh(t[2].id)).groupId, t[1].id);
  assert.equal(await prisma.order.count({ where: { tableId: t[0].id, status: 'OPEN' } }), 1);
  await tablesService.separate(r, t[2].id);
  assert.equal((await fresh(t[1].id)).groupId, null);
  await assert.rejects(tablesService.separate(r, t[1].id), isHttp(400));
});

test('cobrar todo junto: una sola venta con los pedidos de todas, libera todas y deshace el grupo', async () => {
  const { r, t, order } = await salon();
  await tablesService.join(r, t[0].id, [t[1].id]);
  await order(t[0].id, 2);
  await order(t[1].id, 3);
  // El monto tiene que cubrir el total del grupo
  await assert.rejects(
    salesService.create(r, { tableId: t[1].id, wholeGroup: true, paymentMethod: 'CASH', amount: 4000 }), isHttp(400));
  const sale = await salesService.create(r, { tableId: t[1].id, wholeGroup: true, paymentMethod: 'CASH', amount: 5000 });
  assert.equal(Number(sale.total), 5000);
  assert.equal(sale.tableName, 'Ventana + Patio');
  const items = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
  assert.equal(items.reduce((n, i) => n + i.quantity, 0), 5);
  assert.equal(await prisma.order.count({ where: { saleId: sale.id, status: 'PAID' } }), 2);
  for (const id of [t[0].id, t[1].id]) {
    const x = await fresh(id);
    assert.equal(x.status, 'AVAILABLE');
    assert.equal(x.groupId, null);
  }
  // Cobrar otra vez no genera otra venta
  await assert.rejects(salesService.create(r, { tableId: t[0].id, wholeGroup: true, paymentMethod: 'CASH', amount: 5000 }), isHttp(409));
  assert.equal(await prisma.sale.count({ where: { restaurantId: r } }), 1);
});

test('cobrar por mesa: solo esa mesa; las demás siguen unidas si quedan dos', async () => {
  const { r, t, order } = await salon();
  await tablesService.join(r, t[0].id, [t[1].id, t[2].id]);
  await order(t[0].id, 1);
  await order(t[1].id, 2);
  const sale = await salesService.create(r, { tableId: t[1].id, paymentMethod: 'CARD', amount: 2000 });
  assert.equal(Number(sale.total), 2000);
  assert.equal(sale.tableName, 'Patio');
  assert.equal((await fresh(t[1].id)).groupId, null);
  assert.equal((await fresh(t[0].id)).groupId, t[0].id);
  assert.equal((await fresh(t[2].id)).groupId, t[0].id);
  // La Ventana sigue con su pedido sin cobrar
  assert.equal(await prisma.order.count({ where: { tableId: t[0].id, status: 'OPEN' } }), 1);
});

test('liberar una mesa del grupo sin consumo la saca del grupo', async () => {
  const { r, t } = await salon();
  await tablesService.join(r, t[0].id, [t[1].id]);
  await tablesService.close(r, t[1].id);
  assert.equal((await fresh(t[1].id)).groupId, null);
  assert.equal((await fresh(t[0].id)).groupId, null);
});

test('concurrencia: cobrar el grupo dos veces a la vez da una sola venta', async () => {
  const { r, t, order } = await salon();
  await tablesService.join(r, t[0].id, [t[1].id]);
  await order(t[0].id, 1);
  await order(t[1].id, 1);
  const results = await Promise.allSettled([
    salesService.create(r, { tableId: t[0].id, wholeGroup: true, paymentMethod: 'CASH', amount: 2000 }),
    salesService.create(r, { tableId: t[1].id, wholeGroup: true, paymentMethod: 'CASH', amount: 2000 }),
  ]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(await prisma.sale.count({ where: { restaurantId: r } }), 1);
});

test('concurrencia: cobrar todo el grupo y una mesa a la vez no cobra nada dos veces', async () => {
  const { r, t, order } = await salon();
  await tablesService.join(r, t[0].id, [t[1].id]);
  await order(t[0].id, 1);
  await order(t[1].id, 1);
  const results = await Promise.allSettled([
    salesService.create(r, { tableId: t[0].id, wholeGroup: true, paymentMethod: 'CASH', amount: 2000 }),
    salesService.create(r, { tableId: t[1].id, paymentMethod: 'CASH', amount: 1000 }),
  ]);
  const sales = await prisma.sale.findMany({ where: { restaurantId: r } });
  const totalSold = sales.reduce((n, s) => n + Number(s.total), 0);
  // Gana uno de los dos: o el grupo entero ($2.000), o la mesa sola ($1.000) y la otra queda abierta
  assert.ok(results.some(x => x.status === 'fulfilled'));
  assert.ok(totalSold === 2000 || totalSold === 1000, `vendido ${totalSold}`);
  const paidOrders = await prisma.order.count({ where: { restaurantId: r, status: 'PAID' } });
  assert.equal(paidOrders, totalSold / 1000);
  for (const x of results) {
    if (x.status === 'rejected') assert.ok(x.reason instanceof HttpError, String(x.reason));
  }
});

test('concurrencia: unir y cobrar a la vez no se traban', async () => {
  const { r, t, order } = await salon();
  await order(t[0].id, 1);
  await order(t[1].id, 1);
  const results = await Promise.allSettled([
    tablesService.join(r, t[1].id, [t[0].id]),
    salesService.create(r, { tableId: t[0].id, paymentMethod: 'CASH', amount: 1000 }),
  ]);
  // Ninguno falla por bloqueo mutuo (el que llega segundo espera o recibe un 409 claro)
  for (const x of results) {
    if (x.status === 'rejected') assert.ok(x.reason instanceof HttpError, String(x.reason));
  }
});

// ──────────────────────────────────────────────
// Mover pedidos a otra mesa (tarea 5.3)
// ──────────────────────────────────────────────
test('mudar toda la mesa: los pedidos pasan, la nueva se abre con los comensales y la vieja queda libre', async () => {
  const { r, t, order } = await salon();
  await order(t[0].id, 1);
  await order(t[0].id, 2);
  const moved = await tablesService.moveOrders(r, t[0].id, t[1].id);
  assert.equal(moved.length, 2);
  assert.equal(await prisma.order.count({ where: { tableId: t[1].id, status: 'OPEN' } }), 2);
  const [from, to] = [await fresh(t[0].id), await fresh(t[1].id)];
  assert.equal(from.status, 'AVAILABLE');
  assert.equal(to.status, 'OCCUPIED');
  assert.equal(to.guestCount, 2);
  // Se cobra en la mesa nueva, con todo
  const sale = await salesService.create(r, { tableId: t[1].id, paymentMethod: 'CASH', amount: 3000 });
  assert.equal(Number(sale.total), 3000);
  assert.equal(await prisma.auditLog.count({ where: { restaurantId: r, action: 'order.move' } }), 1);
});

test('mover un pedido cargado en la mesa equivocada: la de origen sigue abierta con el resto', async () => {
  const { r, t, order } = await salon();
  const ok = await order(t[0].id, 1);
  const wrong = await order(t[0].id, 2);
  await order(t[1].id, 1);
  await tablesService.moveOrders(r, t[0].id, t[1].id, [wrong.id]);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: wrong.id } })).tableId, t[1].id);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: ok.id } })).tableId, t[0].id);
  assert.equal((await fresh(t[0].id)).status, 'OCCUPIED');
});

test('mover: no a la misma mesa, ni a una reservada; ni pedidos de otra mesa o ya cobrados', async () => {
  const { r, t, order } = await salon();
  const a = await order(t[0].id, 1);
  const b = await order(t[1].id, 1);
  await assert.rejects(tablesService.moveOrders(r, t[0].id, t[0].id), isHttp(400));
  await tablesService.reserve(r, t[2].id);
  await assert.rejects(tablesService.moveOrders(r, t[0].id, t[2].id), isHttp(400));
  await assert.rejects(tablesService.moveOrders(r, t[0].id, t[1].id, [b.id]), isHttp(409));
  await salesService.create(r, { tableId: t[0].id, paymentMethod: 'CASH', amount: 1000 });
  await assert.rejects(tablesService.moveOrders(r, t[0].id, t[1].id, [a.id]), isHttp(409));
  await assert.rejects(tablesService.moveOrders(r, t[0].id, t[1].id), isHttp(400)); // ya no tiene pedidos
});

test('mover y cobrar la mesa de origen a la vez: nada queda cobrado y movido a la vez', async () => {
  const { r, t, order } = await salon();
  await order(t[0].id, 1);
  const results = await Promise.allSettled([
    tablesService.moveOrders(r, t[0].id, t[1].id),
    salesService.create(r, { tableId: t[0].id, paymentMethod: 'CASH', amount: 1000 }),
  ]);
  for (const x of results) if (x.status === 'rejected') assert.ok(x.reason instanceof HttpError, String(x.reason));
  const paid = await prisma.order.count({ where: { restaurantId: r, status: 'PAID' } });
  const openInTo = await prisma.order.count({ where: { tableId: t[1].id, status: 'OPEN' } });
  assert.equal(paid + openInTo, 1);
});
