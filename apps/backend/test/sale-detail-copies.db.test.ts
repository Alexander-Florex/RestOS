// ──────────────────────────────────────────────
// Detalle de una venta ya cobrada y copias automáticas de la comanda:
// Entrada + Principal = 2 · Entrada + Principal + Postre = 3 · el resto = 1.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { kitchenCopies } from '../src/lib/kitchen-routing.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { printingService } from '../src/modules/printing/printing.service.js';
import { kickPrinter, resetPrinterStates, startPrinterWorker, stopPrinterWorker } from '../src/modules/printing/printer-worker.js';

const sent: Buffer[] = [];
let failing = false;
const fakePrinter = {
  async print(_target: string, _title: string, data: Buffer) {
    if (failing) throw new Error('sin papel');
    sent.push(data);
  },
};
const httpServer = http.createServer();
before(() => { initSocket(httpServer); startPrinterWorker({ transport: fakePrinter, pollMs: 0 }); });
after(async () => { stopPrinterWorker(); await prisma.restaurant.deleteMany(); await prisma.$disconnect(); httpServer.close(); });
beforeEach(async () => { await prisma.restaurant.deleteMany(); sent.length = 0; failing = false; resetPrinterStates(); });

const isHttp = (status: number) => (err: unknown) => err instanceof HttpError && err.statusCode === status;
/** Cuántos cortes de papel (GS V 1) hay en lo que recibió la impresora */
const cuts = (data: Buffer) => {
  let n = 0;
  for (let i = 0; i + 2 < data.length; i++) if (data[i] === 0x1d && data[i + 1] === 0x56 && data[i + 2] === 0x01) n++;
  return n;
};

async function setup(printer: string | null = 'Comandera') {
  const r = (await prisma.restaurant.create({ data: { name: 'El Molino', printerName: printer } })).id;
  await prisma.menuCategory.createMany({ data: [
    { restaurantId: r, name: 'Entradas', order: 0 },
    { restaurantId: r, name: 'Principales', order: 1 },
    { restaurantId: r, name: 'Postres', order: 2 },
    { restaurantId: r, name: 'Bebidas', order: 3, sendToKitchen: false },
  ] });
  const dish = (name: string, category: string) => prisma.menuItem.create({ data: { restaurantId: r, name, category, price: '1000.00' } });
  const [entrada, principal, postre, bebida] = await Promise.all([
    dish('Empanada', 'Entradas'), dish('Bife', 'Principales'), dish('Flan', 'Postres'), dish('Agua', 'Bebidas'),
  ]);
  const table = await prisma.table.create({ data: { restaurantId: r, number: 1, name: 'Ventana' } });
  const order = (ids: number[]) => ordersService.create(r, { tableId: table.id, guestCount: 2, items: ids.map(menuItemId => ({ menuItemId, quantity: 1 })) });
  return { r, table, entrada, principal, postre, bebida, order };
}

test('kitchenCopies: solo los dos casos pedidos suman copias', () => {
  assert.equal(kitchenCopies(['Entradas', 'Principales']), 2);
  assert.equal(kitchenCopies(['Entradas', 'Principales', 'Postres']), 3);
  assert.equal(kitchenCopies(['ENTRADA', ' principal ', 'Postre']), 3);
  assert.equal(kitchenCopies(['Éntradas', 'Principal']), 2);
  assert.equal(kitchenCopies(['Entradas', 'Entradas', 'Principales', 'Principales']), 2);
  assert.equal(kitchenCopies(['Principales']), 1);
  assert.equal(kitchenCopies(['Entradas']), 1);
  assert.equal(kitchenCopies(['Postres']), 1);
  assert.equal(kitchenCopies(['Principales', 'Postres']), 1);
  assert.equal(kitchenCopies(['Entradas', 'Postres']), 1);
  assert.equal(kitchenCopies(['Entradas', 'Pastas']), 1);
  assert.equal(kitchenCopies([null]), 1);
});

test('la comanda automática manda todas las copias juntas, cada una con su corte', async () => {
  const s = await setup();
  const two = await s.order([s.entrada.id, s.principal.id, s.bebida.id]); // la bebida no cuenta
  const job2 = await printingService.printOrder({ restaurantId: s.r, orderId: two.id, auto: true });
  assert.ok(job2);
  assert.ok(job2.title.endsWith('· x2'));
  await kickPrinter(s.r);
  const three = await s.order([s.entrada.id, s.principal.id, s.postre.id]);
  await printingService.printOrder({ restaurantId: s.r, orderId: three.id, auto: true });
  await kickPrinter(s.r);
  assert.deepEqual(sent.map(cuts), [2, 3]);
  assert.equal(await prisma.printJob.count({ where: { restaurantId: s.r } }), 2);
});

test('un agregado cuenta solo su propio pedido: los postres de después salen una vez', async () => {
  const s = await setup();
  await s.order([s.entrada.id, s.principal.id]);
  const extra = await s.order([s.postre.id]);
  await printingService.printOrder({ restaurantId: s.r, orderId: extra.id, auto: true });
  await kickPrinter(s.r);
  assert.deepEqual(sent.map(cuts), [1]);
});

test('imprimir a mano y reimprimir salen una sola vez', async () => {
  const s = await setup();
  const o = await s.order([s.entrada.id, s.principal.id, s.postre.id]);
  await printingService.printOrder({ restaurantId: s.r, orderId: o.id }); // botón manual
  const auto = await printingService.printOrder({ restaurantId: s.r, orderId: o.id, auto: true });
  assert.ok(auto);
  await kickPrinter(s.r);
  const again = await printingService.reprint(s.r, auto.id);
  assert.ok(!again.title.includes('x3'));
  await kickPrinter(s.r);
  assert.deepEqual(sent.map(cuts), [1, 3, 1]);
});

test('reintentar un trabajo que falló conserva sus copias', async () => {
  const s = await setup();
  const o = await s.order([s.entrada.id, s.principal.id]);
  failing = true;
  const job = await printingService.printOrder({ restaurantId: s.r, orderId: o.id, auto: true });
  assert.ok(job);
  await kickPrinter(s.r);
  assert.equal(sent.length, 0);
  failing = false;
  await printingService.retry(s.r, job.id);
  await kickPrinter(s.r);
  assert.deepEqual(sent.map(cuts), [2]);
});

test('el detalle muestra los pedidos cobrados, con mozo y lo anulado', async () => {
  const s = await setup(null);
  const role = await prisma.role.create({ data: { restaurantId: s.r, name: 'Salón', permissions: ['orders.create'] } });
  const mozo = await prisma.user.create({ data: { restaurantId: s.r, roleId: role.id, username: 'mozo', email: 'mozo@test.local', name: 'Sol', password: 'x' } });
  const first = await ordersService.create(s.r, { tableId: s.table.id, guestCount: 2, createdById: mozo.id, items: [
    { menuItemId: s.entrada.id, quantity: 2 }, { menuItemId: s.principal.id, quantity: 1 },
  ] });
  await s.order([s.postre.id]);
  // Un plato anulado por un cambio: se ve, pero no se cobra
  const voided = first.items.find(i => i.menuItemId === s.principal.id)!;
  await prisma.orderItem.update({ where: { id: voided.id }, data: { status: 'VOIDED', voidReason: 'Salió frío' } });
  const sale = await salesService.create(s.r, {
    tableId: s.table.id, paymentMethod: 'CASH', amount: 5000, discountAmount: 500, discountReason: 'Cliente habitual',
  });

  const d = await salesService.getDetail(s.r, sale.id);
  assert.equal(d.tableName, 'Ventana');
  assert.equal(d.subtotal, 3000);
  assert.equal(d.discount, 500);
  assert.equal(d.discountPct, null);
  assert.equal(d.total, 2500);
  assert.deepEqual(d.payments, [{ method: 'CASH', amount: 2500, tendered: 5000 }]);
  assert.equal(d.orders.length, 2);
  assert.equal(d.orders[0].waiterName, 'Sol');
  const row = d.orders[0].items.find(i => i.itemName === 'Bife')!;
  assert.equal(row.status, 'VOIDED');
  assert.equal(row.voidReason, 'Salió frío');
  assert.ok(!d.items.some(i => i.itemName === 'Bife')); // lo cobrado no incluye lo anulado
});

test('el detalle de una venta de otro local da 404', async () => {
  const a = await setup(null);
  const b = await setup(null);
  await a.order([a.principal.id]);
  const sale = await salesService.create(a.r, { tableId: a.table.id, paymentMethod: 'CASH', amount: 1000 });
  await assert.rejects(salesService.getDetail(b.r, sale.id), isHttp(404));
});
