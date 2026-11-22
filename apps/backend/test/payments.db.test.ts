// ──────────────────────────────────────────────
// Pagos (tarea 5.2): varios medios en la misma cuenta, dividir entre comensales,
// descuento con motivo (promo de efectivo). Siempre se cobra el total.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { Request, Response } from 'express';
import { prisma } from '../src/lib/prisma.js';
import { salesController } from '../src/modules/sales/sales.controller.js';
import { printingService } from '../src/modules/printing/printing.service.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { takeawayService } from '../src/modules/takeaway/takeaway.service.js';
import { reportsService } from '../src/modules/reports/reports.service.js';
import { cashService } from '../src/modules/cash/cash.service.js';
import { localDaysRange, localDayKey } from '../src/lib/time.js';

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
  const dish = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Milanesa', category: 'main', price: '5000.00' } });
  let n = 0;
  /** Mesa abierta con `qty` platos de $5.000; devuelve su id. */
  const table = async (qty = 2) => {
    const t = await prisma.table.create({ data: { restaurantId: r, number: ++n } });
    await ordersService.create(r, { tableId: t.id, guestCount: 2, items: [{ menuItemId: dish.id, quantity: qty }] });
    return t.id;
  };
  return { r, dish, table };
}
const pays = (saleId: number) => prisma.salePayment.findMany({ where: { saleId }, orderBy: { id: 'asc' } });

test('un solo medio (como antes): un pago con lo cobrado; el vuelto queda en tendered', async () => {
  const { r, table } = await setup();
  const sale = await salesService.create(r, { tableId: await table(), paymentMethod: 'CASH', amount: 12000 });
  assert.equal(sale.paymentMethod, 'CASH');
  const p = await pays(sale.id);
  assert.equal(p.length, 1);
  assert.equal(Number(p[0].amount), 10000);
  assert.equal(Number(p[0].tendered), 12000);
  assert.equal(Number(sale.subtotal), 10000);
  assert.equal(Number(sale.discount), 0);
});

test('mixto: tarjeta + efectivo; el vuelto sale solo del efectivo', async () => {
  const { r, table } = await setup();
  const sale = await salesService.create(r, {
    tableId: await table(), payments: [{ method: 'CARD', amount: 6000 }, { method: 'CASH', amount: 5000 }],
  });
  assert.equal(sale.paymentMethod, 'MIXED');
  assert.equal(Number(sale.total), 10000);
  assert.equal(Number(sale.amount), 11000); // lo entregado, con el vuelto
  const p = await pays(sale.id);
  assert.deepEqual(p.map(x => [x.method, Number(x.amount)]), [['CARD', 6000], ['CASH', 4000]]);
  assert.equal(Number(p[1].tendered), 5000);
});

test('dividir entre comensales: tres partes que suman justo el total', async () => {
  const { r, table } = await setup();
  const sale = await salesService.create(r, {
    tableId: await table(), payments: [{ method: 'TRANSFER', amount: 3333.34 }, { method: 'CARD', amount: 3333.33 }, { method: 'CASH', amount: 3333.33 }],
  });
  const p = await pays(sale.id);
  assert.equal(p.reduce((s, x) => s + Math.round(Number(x.amount) * 100), 0), 1_000_000);
});

test('rechaza: no alcanza, tarjeta/transferencia de más, montos inválidos, a cuenta mezclado', async () => {
  const { r, table } = await setup();
  const t = await table();
  await assert.rejects(salesService.create(r, { tableId: t, payments: [{ method: 'CARD', amount: 4000 }, { method: 'CASH', amount: 5000 }] }), isHttp(400));
  await assert.rejects(salesService.create(r, { tableId: t, payments: [{ method: 'CARD', amount: 11000 }] }), isHttp(400));
  await assert.rejects(salesService.create(r, { tableId: t, payments: [{ method: 'CARD', amount: 8000 }, { method: 'TRANSFER', amount: 3000 }] }), isHttp(400));
  await assert.rejects(salesService.create(r, { tableId: t, payments: [{ method: 'CASH', amount: 0 }, { method: 'CARD', amount: 10000 }] }), isHttp(400));
  await assert.rejects(salesService.create(r, { tableId: t, payments: [{ method: 'ACCOUNT', amount: 5000 }, { method: 'CASH', amount: 5000 }] }), isHttp(400));
  await assert.rejects(salesService.create(r, { tableId: t, payments: [] }), isHttp(400));
  // La mesa sigue abierta: ningún intento dejó una venta
  assert.equal(await prisma.sale.count({ where: { restaurantId: r } }), 0);
});

test('descuento: % con motivo; se cobra el total con descuento y queda en auditoría', async () => {
  const { r, table } = await setup();
  await assert.rejects(salesService.create(r, { tableId: await table(), paymentMethod: 'CASH', amount: 9000, discountPct: 10 }), isHttp(400)); // sin motivo
  const sale = await salesService.create(r, {
    tableId: await table(), paymentMethod: 'CASH', amount: 9000, discountPct: 10, discountReason: 'Promo efectivo',
  });
  assert.equal(Number(sale.subtotal), 10000);
  assert.equal(Number(sale.discount), 1000);
  assert.equal(Number(sale.total), 9000);
  const log = await prisma.auditLog.findFirstOrThrow({ where: { restaurantId: r, action: 'sale.create', entityId: sale.id } });
  assert.equal((log.after as { discount: string }).discount, '1000');
  // No alcanza con el total sin descontar mal calculado
  await assert.rejects(salesService.create(r, { tableId: await table(), paymentMethod: 'CASH', amount: 8999.99, discountPct: 10, discountReason: 'x promo' }), isHttp(400));
  await assert.rejects(salesService.create(r, { tableId: await table(), paymentMethod: 'CASH', amount: 0, discountPct: 100.5, discountReason: 'invita la casa' }), isHttp(400));
});

test('descuento redondea al centavo; 100 % deja la cuenta en cero (invita la casa)', async () => {
  const { r, dish } = await setup();
  await prisma.menuItem.update({ where: { id: dish.id }, data: { price: '3333.33' } });
  const t = await prisma.table.create({ data: { restaurantId: r, number: 90 } });
  await ordersService.create(r, { tableId: t.id, guestCount: 1, items: [{ menuItemId: dish.id, quantity: 1 }] });
  const sale = await salesService.create(r, { tableId: t.id, paymentMethod: 'CASH', amount: 3000, discountPct: 10, discountReason: 'promo' });
  assert.equal(Number(sale.discount), 333.33);
  assert.equal(Number(sale.total), 3000);
  const t2 = await prisma.table.create({ data: { restaurantId: r, number: 91 } });
  await ordersService.create(r, { tableId: t2.id, guestCount: 1, items: [{ menuItemId: dish.id, quantity: 1 }] });
  const free = await salesService.create(r, { tableId: t2.id, paymentMethod: 'CASH', amount: 0, discountPct: 100, discountReason: 'invita la casa' });
  assert.equal(Number(free.total), 0);
});

test('descuento por monto en pesos: se resta justo, sin porcentaje, y sale en el ticket', async () => {
  const { r, table } = await setup();
  const sale = await salesService.create(r, {
    tableId: await table(), paymentMethod: 'CARD', amount: 5000, discountAmount: 5000, discountReason: 'Cliente habitual',
  });
  assert.equal(Number(sale.subtotal), 10000);
  assert.equal(Number(sale.discount), 5000);
  assert.equal(sale.discountPct, null);
  assert.equal(Number(sale.total), 5000);
  assert.deepEqual((await pays(sale.id)).map(p => [p.method, Number(p.amount)]), [['CARD', 5000]]);
  const job = await printingService.printSale({ restaurantId: r, saleId: sale.id });
  const lines = job.doc.lines.map(l => l.text);
  assert.ok(lines.some(l => l.startsWith('Descuento (Cliente habitual)') && l.endsWith('-$5.000,00')));
  assert.ok(!lines.some(l => l.includes('%')));
});

test('descuento por monto: rechaza más que la cuenta, sin motivo y % junto con $', async () => {
  const { r, table } = await setup();
  const t = await table();
  await assert.rejects(salesService.create(r, { tableId: t, paymentMethod: 'CASH', amount: 0, discountAmount: 10000.01, discountReason: 'de más' }), isHttp(400));
  await assert.rejects(salesService.create(r, { tableId: t, paymentMethod: 'CASH', amount: 5000, discountAmount: 5000 }), isHttp(400));
  await assert.rejects(salesService.create(r, { tableId: t, paymentMethod: 'CASH', amount: 5000, discountAmount: 5000, discountPct: 10, discountReason: 'los dos' }), isHttp(400));
  assert.equal(await prisma.sale.count({ where: { restaurantId: r } }), 0);
  // El monto exacto de la cuenta sí: invita la casa
  const free = await salesService.create(r, { tableId: t, paymentMethod: 'CASH', amount: 0, discountAmount: 10000, discountReason: 'invita la casa' });
  assert.equal(Number(free.total), 0);
});

test('descuento por monto: sin el permiso "Hacer descuentos" el servidor lo rechaza', async () => {
  const { r, table } = await setup();
  const role = await prisma.role.create({ data: { restaurantId: r, name: 'Solo cobra', permissions: ['sales.charge'] } });
  const user = await prisma.user.create({ data: { restaurantId: r, roleId: role.id, username: 'cobra', email: 'cobra@test.local', name: 'Cobra', password: 'x' } });
  const req = {
    user: { userId: user.id, restaurantId: r },
    body: { tableId: await table(), paymentMethod: 'CASH', amount: 5000, discountAmount: 5000, discountReason: 'sin permiso' },
  } as unknown as Request;
  await assert.rejects(salesController.create(req, {} as Response), isHttp(403));
  assert.equal(await prisma.sale.count({ where: { restaurantId: r } }), 0);
});

test('reportes y caja suman por medio de pago real (también las mixtas)', async () => {
  const { r, table } = await setup();
  await cashService.open(r, 0, null);
  await salesService.create(r, { tableId: await table(), payments: [{ method: 'CARD', amount: 6000 }, { method: 'CASH', amount: 5000 }] });
  await salesService.create(r, { tableId: await table(), paymentMethod: 'TRANSFER', amount: 10000 });
  const rep = await reportsService.salesReport(r, localDaysRange(localDayKey(new Date())));
  const by = Object.fromEntries(rep.byPaymentMethod.map(m => [m.method, m.amount]));
  assert.equal(by.CARD, 6000);
  assert.equal(by.CASH, 4000);
  assert.equal(by.TRANSFER, 10000);
  assert.equal(rep.totals.totalCollected, 20000);
  const stats = await salesService.dailyStats(r);
  assert.equal(stats.byMethod.CASH.amount, 4000);
  assert.equal(stats.byMethod.CARD.amount, 6000);
  const s = (await cashService.current(r)).open!.summary;
  assert.equal(s.sales.CASH.amount, 4000);
  assert.equal(s.expectedCash, 4000);
});

test('para llevar cobrado también registra su pago', async () => {
  const { r, dish } = await setup();
  const tk = await takeawayService.create(r, { customerName: 'Ana', items: [{ menuItemId: dish.id, quantity: 1 }] });
  await takeawayService.pay(r, tk.id, 'CASH', 6000);
  const sale = await prisma.sale.findFirstOrThrow({ where: { takeawayOrderId: tk.id } });
  const p = await pays(sale.id);
  assert.equal(p.length, 1);
  assert.equal(Number(p[0].amount), 5000);
  assert.equal(Number(p[0].tendered), 6000);
});
