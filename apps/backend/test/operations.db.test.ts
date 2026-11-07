// ──────────────────────────────────────────────
// operations.db.test.ts — Reglas de operación que protegen ventas y stock:
// liberar mesas, cobro sin consumo, estados de "para llevar" e inventario.
// Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TableStatus, TakeawayStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { tablesService } from '../src/modules/tables/tables.service.js';
import { takeawayService } from '../src/modules/takeaway/takeaway.service.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';
import { reservationsService } from '../src/modules/reservations/reservations.service.js';
import { reportsService } from '../src/modules/reports/reports.service.js';
import { localDaysRange } from '../src/lib/time.js';

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
  const table = await prisma.table.create({ data: { restaurantId: restaurant.id, number: 1, capacity: 4 } });
  const menuItem = await prisma.menuItem.create({
    data: { restaurantId: restaurant.id, name: 'Empanada', category: 'starters', price: '1500.50' },
  });
  return { restaurantId: restaurant.id, tableId: table.id, menuItemId: menuItem.id };
}

async function rejectsWith(promise: Promise<unknown>, status: number) {
  await assert.rejects(promise, (err) => err instanceof HttpError && err.statusCode === status);
}

// ── Mesas ──

test('no se puede liberar sin venta una mesa con pedidos', async () => {
  const { restaurantId, tableId, menuItemId } = await setup();
  await ordersService.create(restaurantId, { tableId, guestCount: 2, items: [{ menuItemId, quantity: 1 }] });

  await rejectsWith(tablesService.close(restaurantId, tableId), 409);

  const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
  assert.equal(table.status, TableStatus.OCCUPIED);
  assert.equal(await prisma.order.count({ where: { tableId } }), 1);
});

test('una mesa abierta sin pedidos se libera sin venta', async () => {
  const { restaurantId, tableId } = await setup();
  await tablesService.open(restaurantId, tableId, 2);

  const table = await tablesService.close(restaurantId, tableId);

  assert.equal(table.status, TableStatus.AVAILABLE);
  assert.equal(table.guestCount, null);
});

test('cobrar una mesa abierta sin consumo no crea una venta de $0', async () => {
  const { restaurantId, tableId } = await setup();
  await tablesService.open(restaurantId, tableId, 2);

  await rejectsWith(salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 0 }), 400);

  assert.equal(await prisma.sale.count({ where: { restaurantId } }), 0);
  const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
  assert.equal(table.status, TableStatus.OCCUPIED);
});

// ── Para llevar ──

async function takeaway(restaurantId: number, menuItemId: number) {
  return takeawayService.create(restaurantId, { customerName: 'Ana', items: [{ menuItemId, quantity: 2 }] });
}

test('para llevar: el total se calcula en centavos', async () => {
  const { restaurantId, menuItemId } = await setup();
  const order = await takeaway(restaurantId, menuItemId);
  assert.equal(order.total?.toFixed(2), '3001.00');
});

test('para llevar: rechaza un cobro menor al total', async () => {
  const { restaurantId, menuItemId } = await setup();
  const order = await takeaway(restaurantId, menuItemId);

  await rejectsWith(takeawayService.pay(restaurantId, order.id, 'CASH', 3000.99), 400);

  const fresh = await prisma.takeawayOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(fresh.status, TakeawayStatus.OPEN);
});

test('para llevar: dos cobros simultáneos cobran una sola vez', async () => {
  const { restaurantId, menuItemId } = await setup();
  const order = await takeaway(restaurantId, menuItemId);

  const results = await Promise.allSettled([
    takeawayService.pay(restaurantId, order.id, 'CASH', 3001),
    takeawayService.pay(restaurantId, order.id, 'CARD', 3001),
  ]);

  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof HttpError && rejected.reason.statusCode === 409);
});

test('para llevar: no se cobra uno cancelado ni se cancela uno cobrado', async () => {
  const { restaurantId, menuItemId } = await setup();
  const cancelled = await takeaway(restaurantId, menuItemId);
  await takeawayService.cancel(restaurantId, cancelled.id);
  await rejectsWith(takeawayService.pay(restaurantId, cancelled.id, 'CASH', 5000), 409);
  await rejectsWith(takeawayService.markReady(restaurantId, cancelled.id), 409);

  const paid = await takeaway(restaurantId, menuItemId);
  await takeawayService.markReady(restaurantId, paid.id);
  await takeawayService.pay(restaurantId, paid.id, 'CASH', 5000);
  await rejectsWith(takeawayService.cancel(restaurantId, paid.id), 409);

  const fresh = await prisma.takeawayOrder.findUniqueOrThrow({ where: { id: paid.id } });
  assert.equal(fresh.status, TakeawayStatus.PAID);
  assert.equal(fresh.amountPaid?.toFixed(2), '5000.00');
});

test('para llevar: solo se borra un pedido cancelado, nunca uno cobrado', async () => {
  const { restaurantId, menuItemId } = await setup();
  const open = await takeaway(restaurantId, menuItemId);
  await rejectsWith(takeawayService.remove(restaurantId, open.id), 409);

  const paid = await takeaway(restaurantId, menuItemId);
  await takeawayService.pay(restaurantId, paid.id, 'CASH', 3001);
  await rejectsWith(takeawayService.remove(restaurantId, paid.id), 409);
  assert.equal(await prisma.takeawayOrder.count({ where: { id: paid.id } }), 1);

  await takeawayService.cancel(restaurantId, open.id);
  await takeawayService.remove(restaurantId, open.id);
  assert.equal(await prisma.takeawayOrder.count({ where: { id: open.id } }), 0);
});

// ── Inventario ──

test('inventario: no se consume más de lo que hay y las reposiciones simultáneas suman', async () => {
  const { restaurantId } = await setup();
  const item = await inventoryService.create(restaurantId, { name: 'Harina', category: 'FOOD', quantity: 10, unit: 'kg' });

  await rejectsWith(inventoryService.consume(restaurantId, item.id, 11), 400);
  await Promise.all(Array.from({ length: 5 }, () => inventoryService.restock(restaurantId, item.id, 2)));
  const after = await inventoryService.consume(restaurantId, item.id, 20);

  assert.equal(after.quantity, 0);
});

// ── Concurrencia de mesas ──

test('anular un pedido mientras se cobra: o se cobra sin él, o la anulación falla', async () => {
  const { restaurantId, tableId, menuItemId } = await setup();
  await ordersService.create(restaurantId, { tableId, guestCount: 2, items: [{ menuItemId, quantity: 1 }] });
  const extra = await ordersService.create(restaurantId, { tableId, items: [{ menuItemId, quantity: 1 }] });

  const [sale, removal] = await Promise.allSettled([
    salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 3001 }),
    ordersService.cancel(restaurantId, extra.id, { reason: 'test de concurrencia' }),
  ]);

  const saved = await prisma.sale.findFirst({ where: { restaurantId } });
  if (removal.status === 'fulfilled' && sale.status === 'fulfilled') {
    // La anulación entró primero: la venta no puede incluir el pedido anulado
    assert.equal(saved?.total.toFixed(2), '1500.50');
  } else if (removal.status === 'rejected') {
    // El cobro entró primero: el pedido ya está cobrado y no se puede anular
    assert.equal(sale.status, 'fulfilled');
    assert.equal(saved?.total.toFixed(2), '3001.00');
  }
});

test('sentar una reserva sobre una mesa ya ocupada se rechaza y no la pisa', async () => {
  const { restaurantId, tableId } = await setup();
  const reservation = await prisma.reservation.create({
    data: { restaurantId, tableId, customerName: 'Luis', partySize: 3, reservedAt: new Date() },
  });
  await tablesService.open(restaurantId, tableId, 2);

  await rejectsWith(reservationsService.seat(restaurantId, reservation.id), 400);

  const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
  assert.equal(table.guestCount, 2);
  const fresh = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
  assert.notEqual(fresh.status, 'SEATED');
});

// ── Para llevar dentro de las ventas (0.3) ──

test('para llevar: cobrar crea una venta TAKEAWAY con ítems y notas', async () => {
  const { restaurantId, menuItemId } = await setup();
  const order = await takeaway(restaurantId, menuItemId);

  const { sale } = await takeawayService.pay(restaurantId, order.id, 'CARD', 3001, { notes: 'retira el hermano' });

  const saved = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true } });
  assert.equal(saved.channel, 'TAKEAWAY');
  assert.equal(saved.takeawayOrderId, order.id);
  assert.equal(saved.tableNumber, null);
  assert.equal(saved.total.toFixed(2), '3001.00');
  assert.equal(saved.paymentMethod, 'CARD');
  assert.equal(saved.notes, 'retira el hermano');
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].quantity, 2);
  assert.equal(saved.items[0].category, 'starters');
  assert.equal(saved.items[0].subtotal.toFixed(2), '3001.00');
});

test('para llevar: dos cobros simultáneos generan una sola venta', async () => {
  const { restaurantId, menuItemId } = await setup();
  const order = await takeaway(restaurantId, menuItemId);

  await Promise.allSettled([
    takeawayService.pay(restaurantId, order.id, 'CASH', 3001),
    takeawayService.pay(restaurantId, order.id, 'CARD', 3001),
    takeawayService.pay(restaurantId, order.id, 'TRANSFER', 3001),
  ]);

  assert.equal(await prisma.sale.count({ where: { takeawayOrderId: order.id } }), 1);
});

test('para llevar: un cobro rechazado no deja venta ni cambia el estado', async () => {
  const { restaurantId, menuItemId } = await setup();
  const order = await takeaway(restaurantId, menuItemId);
  await rejectsWith(takeawayService.pay(restaurantId, order.id, 'CASH', 100), 400);

  assert.equal(await prisma.sale.count({ where: { restaurantId } }), 0);
  const fresh = await prisma.takeawayOrder.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(fresh.status, TakeawayStatus.OPEN);
});

test('reportes: el para llevar entra en totales, canal, ranking y CSV', async () => {
  const { restaurantId, tableId, menuItemId } = await setup();
  await ordersService.create(restaurantId, { tableId, guestCount: 2, items: [{ menuItemId, quantity: 1 }] });
  await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 1500.5 });
  const order = await takeaway(restaurantId, menuItemId);
  await takeawayService.pay(restaurantId, order.id, 'CARD', 3001);

  const range = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
  const report = await reportsService.salesReport(restaurantId, range);
  assert.equal(report.totals.salesCount, 2);
  assert.equal(report.totals.totalSold.toFixed(2), '4501.50');
  const byChannel = Object.fromEntries(report.byChannel.map(c => [c.channel, c.count]));
  assert.deepEqual(byChannel, { DINE_IN: 1, TAKEAWAY: 1 });
  assert.equal(report.byTable.length, 1); // el para llevar no aparece como mesa

  const [top] = await reportsService.topItems(restaurantId, range);
  assert.equal(top.quantity, 3);

  const stats = await salesService.dailyStats(restaurantId);
  assert.equal(stats.count, 2);

  const tickets = await reportsService.dailyTickets(restaurantId, range);
  assert.equal(tickets.find(t => t.channel === 'TAKEAWAY')?.customerName, 'Ana');

  const csv = await reportsService.salesCsv(restaurantId, range);
  assert.match(csv, /Para llevar,,Ana,CARD/);
});

// ── Zona horaria ──

test('reportes por día local: una venta a las 22:30 cuenta en ese día, no en el siguiente', async () => {
  const { restaurantId } = await setup();
  const sale = (closedAt: string, total: string) => prisma.sale.create({
    data: { restaurantId, tableNumber: 1, total, amount: total, paymentMethod: 'CASH', closedAt: new Date(closedAt) },
  });
  await sale('2026-10-30T01:30:00Z', '100.00'); // 29/10 22:30 en Buenos Aires
  await sale('2026-10-30T03:30:00Z', '50.00');  // 30/10 00:30 en Buenos Aires

  const day29 = await salesService.dailyStats(restaurantId, '2026-10-29');
  assert.equal(day29.count, 1);
  assert.equal(day29.total, 100);
  const day30 = await salesService.dailyStats(restaurantId, '2026-10-30');
  assert.equal(day30.count, 1);
  assert.equal(day30.total, 50);

  const tickets = await reportsService.dailyTickets(restaurantId, localDaysRange('2026-10-29'));
  assert.equal(tickets.length, 1);

  const report = await reportsService.salesReport(restaurantId, localDaysRange('2026-10-29', '2026-10-30'));
  assert.deepEqual(report.byDay.map(d => [d.date, d.count]), [['2026-10-29', 1], ['2026-10-30', 1]]);

  const csv = await reportsService.salesCsv(restaurantId, localDaysRange('2026-10-29'));
  assert.match(csv, /2026-10-29 22:30:00/);
});
