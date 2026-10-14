// ──────────────────────────────────────────────
// Tests de cobro de mesa (tarea 0.2) contra MySQL real.
// Requiere la base de test levantada (ver README, "Tests").
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { TableStatus } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { reportsService } from '../src/modules/reports/reports.service.js';

const httpServer = http.createServer();

before(() => {
  // Los services emiten eventos por socket: alcanza con un io sin escuchar puerto
  initSocket(httpServer);
});

after(async () => {
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  httpServer.close();
});

beforeEach(async () => {
  // Restaurant tiene onDelete: Cascade en todas sus relaciones
  await prisma.restaurant.deleteMany();
});

/** Crea restaurante + mesa + plato y abre la mesa con un pedido. */
async function openTable(opts: { price?: string; quantity?: number } = {}) {
  const restaurant = await prisma.restaurant.create({ data: { name: 'Test' } });
  const table = await prisma.table.create({
    data: { restaurantId: restaurant.id, number: 1, capacity: 4 },
  });
  const menuItem = await prisma.menuItem.create({
    data: { restaurantId: restaurant.id, name: 'Milanesa', category: 'main-dishes', price: opts.price ?? '8000.00' },
  });
  await ordersService.create(restaurant.id, {
    tableId: table.id,
    guestCount: 2,
    items: [{ menuItemId: menuItem.id, quantity: opts.quantity ?? 1 }],
  });
  return { restaurantId: restaurant.id, tableId: table.id, menuItemId: menuItem.id };
}

function isHttpError(err: unknown, status: number) {
  return err instanceof HttpError && err.statusCode === status;
}

test('cobra la mesa: crea la venta, borra los pedidos y libera la mesa', async () => {
  const { restaurantId, tableId } = await openTable({ price: '8000.00', quantity: 2 });

  const sale = await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 16000 });

  assert.equal(Number(sale.total), 16000);
  assert.equal(Number(sale.amount), 16000);
  const items = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, 2);
  assert.equal(await prisma.order.count({ where: { tableId } }), 0);
  const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
  assert.equal(table.status, TableStatus.AVAILABLE);
  assert.equal(table.guestCount, null);
});

test('dos cobros simultáneos de la misma mesa: una sola venta y un 409', async () => {
  for (let i = 0; i < 10; i++) {
    await prisma.restaurant.deleteMany();
    const { restaurantId, tableId } = await openTable();

    const results = await Promise.allSettled([
      salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 8000 }),
      salesService.create(restaurantId, { tableId, paymentMethod: 'CARD', amount: 8000 }),
    ]);

    const ok = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    assert.equal(ok.length, 1, `iteración ${i}: debe haber exactamente un cobro exitoso`);
    assert.ok(isHttpError(failed[0].reason, 409), `iteración ${i}: el segundo cobro debe dar 409, dio ${failed[0].reason}`);
    assert.equal(await prisma.sale.count({ where: { restaurantId } }), 1, `iteración ${i}: debe haber una sola venta`);
  }
});

test('pedido y cobro simultáneos: nunca queda un pedido huérfano en una mesa libre', async () => {
  for (let i = 0; i < 10; i++) {
    await prisma.restaurant.deleteMany();
    const { restaurantId, tableId, menuItemId } = await openTable({ price: '8000.00' });

    // El cobro usa el total que se veía en pantalla (8000); el pedido suma 8000 más
    const results = await Promise.allSettled([
      salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 8000 }),
      ordersService.create(restaurantId, { tableId, items: [{ menuItemId, quantity: 1 }] }),
    ]);

    const [saleResult, orderResult] = results;
    // Exactamente una de las dos operaciones gana:
    //  - pedido primero → el total sube a 16000 y el cobro de 8000 se rechaza (400)
    //  - cobro primero  → la mesa queda libre y el pedido sin guestCount se rechaza (400)
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, `iteración ${i}: debe ganar una sola operación`);
    const loser = saleResult.status === 'rejected' ? saleResult : orderResult;
    assert.ok(loser.status === 'rejected' && isHttpError(loser.reason, 400), `iteración ${i}: la operación perdedora debe dar 400`);

    const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
    const pendingOrders = await prisma.order.count({ where: { tableId } });
    if (table.status === TableStatus.AVAILABLE) {
      assert.equal(pendingOrders, 0, `iteración ${i}: mesa libre con pedidos huérfanos`);
    } else {
      assert.equal(pendingOrders, 2, `iteración ${i}: la mesa abierta debe conservar los dos pedidos`);
      assert.equal(await prisma.sale.count({ where: { restaurantId } }), 0);
    }
  }
});

test('rechaza un cobro menor al total y deja la mesa abierta', async () => {
  const { restaurantId, tableId } = await openTable({ price: '8000.00' });

  await assert.rejects(
    salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 7999.99 }),
    (err) => isHttpError(err, 400),
  );

  assert.equal(await prisma.sale.count(), 0);
  assert.equal(await prisma.order.count({ where: { tableId } }), 1);
  const table = await prisma.table.findUniqueOrThrow({ where: { id: tableId } });
  assert.equal(table.status, TableStatus.OCCUPIED);
});

test('acepta pago con vuelto: guarda lo entregado, pero lo cobrado en reportes es el total', async () => {
  const { restaurantId, tableId } = await openTable({ price: '8000.00' });

  const sale = await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 10000 });
  assert.equal(Number(sale.amount), 10000);
  assert.equal(Number(sale.total), 8000);

  const stats = await salesService.dailyStats(restaurantId);
  assert.equal(stats.total, 8000);
  assert.equal(stats.byMethod.CASH.amount, 8000);

  const report = await reportsService.salesReport(restaurantId, {
    from: new Date(Date.now() - 60_000),
    to: new Date(Date.now() + 60_000),
  });
  assert.equal(report.totals.totalSold, 8000);
  assert.equal(report.totals.totalCollected, 8000);
});

test('suma el total en centavos sin error de float', async () => {
  // 3 × 0,10 en float da 0,30000000000000004
  const { restaurantId, tableId } = await openTable({ price: '0.10', quantity: 3 });

  const sale = await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 0.3 });
  assert.equal(Number(sale.total), 0.3);
});

test('mesa libre o reservada: 409 sin crear venta', async () => {
  const restaurant = await prisma.restaurant.create({ data: { name: 'Test' } });
  const free = await prisma.table.create({ data: { restaurantId: restaurant.id, number: 1 } });
  const reserved = await prisma.table.create({
    data: { restaurantId: restaurant.id, number: 2, status: TableStatus.RESERVED },
  });

  for (const t of [free, reserved]) {
    await assert.rejects(
      salesService.create(restaurant.id, { tableId: t.id, paymentMethod: 'CASH', amount: 0 }),
      (err) => isHttpError(err, 409),
    );
  }
  assert.equal(await prisma.sale.count(), 0);
});

test('no se puede cobrar la mesa de otro restaurante', async () => {
  const { tableId } = await openTable();
  const other = await prisma.restaurant.create({ data: { name: 'Otro' } });

  await assert.rejects(
    salesService.create(other.id, { tableId, paymentMethod: 'CASH', amount: 8000 }),
    (err) => isHttpError(err, 404),
  );
  assert.equal(await prisma.sale.count(), 0);
});
