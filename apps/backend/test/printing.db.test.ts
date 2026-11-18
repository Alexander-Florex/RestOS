// ──────────────────────────────────────────────
// Comandera (tarea 1.1): cada impresión queda como trabajo, con el ticket armado
// desde la base, separado por restaurante, y se puede reimprimir y confirmar.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { printingService } from '../src/modules/printing/printing.service.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
after(async () => { await prisma.restaurant.deleteMany(); await prisma.$disconnect(); httpServer.close(); });
beforeEach(async () => { await prisma.restaurant.deleteMany(); });

const isHttp = (status: number) => (err: unknown) => err instanceof HttpError && err.statusCode === status;
const texts = (job: { doc: { lines: { text: string }[] } }) => job.doc.lines.map(l => l.text);

async function setup(name = 'El Molino') {
  const r = (await prisma.restaurant.create({ data: { name } })).id;
  const dish = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Milanesa', category: 'main', price: '5000.00' } });
  const table = await prisma.table.create({ data: { restaurantId: r, number: 4, name: 'Ventana' } });
  const order = await ordersService.create(r, { tableId: table.id, guestCount: 2, items: [{ menuItemId: dish.id, quantity: 2, notes: 'bien cocida' }] });
  return { r, dish, table, order };
}

test('la comanda queda como trabajo pendiente, con el nombre del local, la mesa por nombre y la nota', async () => {
  const { r, order } = await setup();
  const job = await printingService.printOrder({ restaurantId: r, orderId: order.id });
  assert.equal(job.status, 'PENDING');
  assert.equal(job.kind, 'kitchen');
  assert.equal(job.title, `Comanda · Ventana · #${order.id}`);
  assert.equal(job.doc.paperWidth, 80);
  const t = texts(job);
  assert.equal(t[0], 'El Molino');
  assert.ok(t.includes('VENTANA'));
  assert.ok(t.includes('2x Milanesa'));
  assert.ok(t.includes('   >> bien cocida'));
  const saved = await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(saved.restaurantId, r);
});

test('ancho de papel de 58 mm: 32 caracteres; el ejemplo usa el del local', async () => {
  const { r, order } = await setup();
  await printingService.setSettings(r, 58, null);
  assert.deepEqual(await printingService.getSettings(r), { paperWidth: 58 });
  const job = await printingService.printOrder({ restaurantId: r, orderId: order.id });
  assert.equal(job.doc.columns, 32);
  assert.equal((await printingService.sample(r, 'cash')).columns, 32);
  assert.equal((await printingService.sample(r, 'cash', 80)).columns, 48);
  assert.equal(await prisma.auditLog.count({ where: { restaurantId: r, action: 'printing.settings' } }), 1);
});

test('ticket de caja desde la venta: descuento, pagos y vuelto como quedaron guardados', async () => {
  const { r, table } = await setup();
  const sale = await salesService.create(r, {
    tableId: table.id, payments: [{ method: 'CASH', amount: 10000 }], discountPct: 10, discountReason: 'Promo efectivo',
  } as Parameters<typeof salesService.create>[1]);
  const job = await printingService.printSale({ restaurantId: r, saleId: sale.id });
  const t = texts(job);
  assert.equal(job.title, `Ticket de caja · Ventana · Venta #${sale.id}`);
  assert.ok(t.some(l => l.startsWith('Subtotal') && l.endsWith('$10.000,00')));
  assert.ok(t.some(l => l.startsWith('Descuento 10 % (Promo efectivo)') && l.endsWith('-$1.000,00')));
  assert.ok(t.some(l => l.startsWith('TOTAL') && l.endsWith('$9.000,00')));
  assert.ok(t.some(l => l.startsWith('   Vuelto') && l.endsWith('$1.000,00')));
});

test('cada local ve solo sus trabajos; reimprimir crea otro vinculado; el agente confirma o avisa el error', async () => {
  const a = await setup('Local A');
  const b = await setup('Local B');
  const jobA = await printingService.printOrder({ restaurantId: a.r, orderId: a.order.id });
  await printingService.printOrder({ restaurantId: b.r, orderId: b.order.id });

  assert.deepEqual((await printingService.listJobs(a.r)).map(j => j.id), [jobA.id]);
  await assert.rejects(printingService.printOrder({ restaurantId: a.r, orderId: b.order.id }), isHttp(404));
  await assert.rejects(printingService.reprint(b.r, jobA.id), isHttp(404));
  await assert.rejects(printingService.markJob(b.r, jobA.id, true), isHttp(404));

  const again = await printingService.reprint(a.r, jobA.id);
  assert.equal(again.reprintOfId, jobA.id);
  assert.deepEqual(texts(again).slice(0, 4), texts(jobA).slice(0, 4));
  assert.deepEqual((await printingService.listJobs(a.r)).map(j => j.id), [again.id, jobA.id]);

  const ok = await printingService.markJob(a.r, jobA.id, true);
  assert.equal(ok.status, 'PRINTED');
  assert.ok(ok.printedAt);
  const failed = await printingService.markJob(a.r, again.id, false, 'Sin papel');
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.error, 'Sin papel');
});

test('un pedido sin platos activos no se imprime', async () => {
  const { r, order } = await setup();
  await prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { status: 'VOIDED' } });
  await assert.rejects(printingService.printOrder({ restaurantId: r, orderId: order.id }), isHttp(400));
});
