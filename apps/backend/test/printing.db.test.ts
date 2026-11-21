// ──────────────────────────────────────────────
// Comandera (tarea 1.1): cada impresión queda como trabajo, con el ticket armado
// desde la base, separado por restaurante, y se puede reimprimir. La cola de impresión
// (printer-worker.ts) lo manda a la impresora del local, reintenta y avisa si no salió.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { printingService } from '../src/modules/printing/printing.service.js';
import { orderChangesService } from '../src/modules/orders/order-changes.service.js';
import { kickPrinter, resetPrinterStates, startPrinterWorker, stopPrinterWorker, MAX_ATTEMPTS } from '../src/modules/printing/printer-worker.js';
import { parsePrinterTarget, printNetwork } from '../src/lib/printers/index.js';

// Impresora de mentira: guarda lo que recibe o falla cuando se le pide
const sent: Array<{ target: string; title: string; data: Buffer }> = [];
let failWith: string | null = null;
const fakePrinter = {
  async print(target: string, title: string, data: Buffer) {
    if (failWith) throw new Error(failWith);
    sent.push({ target, title, data });
  },
};

const httpServer = http.createServer();
before(() => { initSocket(httpServer); startPrinterWorker({ transport: fakePrinter, pollMs: 0 }); });
after(async () => { stopPrinterWorker(); await prisma.restaurant.deleteMany(); await prisma.$disconnect(); httpServer.close(); });
beforeEach(async () => { await prisma.restaurant.deleteMany(); sent.length = 0; failWith = null; resetPrinterStates(); });

const isHttp = (status: number) => (err: unknown) => err instanceof HttpError && err.statusCode === status;
const texts = (job: { doc: { lines: { text: string }[] } }) => job.doc.lines.map(l => l.text);
/** Comanda que sí tiene que salir (los pedidos de estos tests llevan platos) */
async function printedOrder(opts: { restaurantId: number; orderId: number }) {
  const job = await printingService.printOrder(opts);
  assert.ok(job);
  return job;
}

async function setup(name = 'El Molino') {
  const r = (await prisma.restaurant.create({ data: { name } })).id;
  const dish = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Milanesa', category: 'main', price: '5000.00' } });
  const table = await prisma.table.create({ data: { restaurantId: r, number: 4, name: 'Ventana' } });
  const order = await ordersService.create(r, { tableId: table.id, guestCount: 2, items: [{ menuItemId: dish.id, quantity: 2, notes: 'bien cocida' }] });
  return { r, dish, table, order };
}

test('la comanda queda como trabajo pendiente, con el nombre del local, la mesa por nombre y la nota', async () => {
  const { r, order } = await setup();
  const job = await printedOrder({ restaurantId: r, orderId: order.id });
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

test('la comanda no lleva bebidas, en mesa y para llevar; solo bebidas no genera ticket', async () => {
  const { r, dish, table } = await setup();
  await prisma.menuCategory.create({ data: { restaurantId: r, name: 'Vinos', sendToKitchen: false } });
  const vino = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Malbec', category: 'Vinos', price: '9000.00' } });
  // Categoría sin fila propia: las bebidas se reconocen por nombre
  const agua = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Agua', category: 'drinks', price: '1000.00' } });

  const mixed = await ordersService.create(r, { tableId: table.id, items: [
    { menuItemId: dish.id, quantity: 1 }, { menuItemId: vino.id, quantity: 1 }, { menuItemId: agua.id, quantity: 1 },
  ] });
  const job = await printedOrder({ restaurantId: r, orderId: mixed.id });
  assert.ok(job);
  const t = texts(job);
  assert.ok(t.includes('1x Milanesa'));
  assert.ok(!t.some(l => l.includes('Malbec') || l.includes('Agua')));

  // Las bebidas siguen en el pedido: se cobran aunque no se impriman
  assert.equal((await prisma.orderItem.count({ where: { orderId: mixed.id, status: 'ACTIVE' } })), 3);

  const before = await prisma.printJob.count({ where: { restaurantId: r } });
  const onlyDrinks = await ordersService.create(r, { tableId: table.id, items: [{ menuItemId: vino.id, quantity: 2 }] });
  assert.equal(await printingService.printOrder({ restaurantId: r, orderId: onlyDrinks.id }), null);
  assert.equal(await prisma.printJob.count({ where: { restaurantId: r } }), before);

  const takeaway = await prisma.takeawayOrder.create({ data: {
    restaurantId: r, customerName: 'Ana', total: '14000.00',
    items: { create: [
      { menuItemId: dish.id, itemName: 'Milanesa', quantity: 1, price: '5000.00' },
      { menuItemId: vino.id, itemName: 'Malbec', quantity: 1, price: '9000.00' },
    ] },
  } });
  const tJob = await printingService.printTakeawayKitchen({ restaurantId: r, takeawayId: takeaway.id });
  assert.ok(tJob);
  assert.ok(texts(tJob).includes('1x Milanesa'));
  assert.ok(!texts(tJob).some(l => l.includes('Malbec')));

  // Si la categoría vuelve a marcarse, la bebida sale
  await prisma.menuCategory.updateMany({ where: { restaurantId: r, name: 'Vinos' }, data: { sendToKitchen: true } });
  const back = await printedOrder({ restaurantId: r, orderId: onlyDrinks.id });
  assert.ok(back && texts(back).includes('2x Malbec'));
});

test('rehacer y cambiar: las bebidas no generan ticket ni figuran en el de cocina', async () => {
  const { r, table, order } = await setup();
  await prisma.menuCategory.create({ data: { restaurantId: r, name: 'Bebidas', sendToKitchen: false } });
  const vino = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Malbec', category: 'Bebidas', price: '9000.00' } });
  const soda = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Soda', category: 'Bebidas', price: '1000.00' } });
  const drinks = await ordersService.create(r, { tableId: table.id, items: [{ menuItemId: vino.id, quantity: 2 }] });
  const change = { reason: 'Prueba de cambio', wasPrepared: false };

  // Las impresiones de cambios no se esperan: se da tiempo a que aparezcan
  const settle = () => new Promise(res => setTimeout(res, 300));
  const jobs = () => prisma.printJob.findMany({ where: { restaurantId: r }, orderBy: { id: 'asc' } });

  await orderChangesService.remake(r, drinks.items[0].id, { quantity: 1, reason: 'Se cayó la copa' });
  await orderChangesService.replace(r, drinks.items[0].id, { ...change, quantity: 1, replacement: { menuItemId: soda.id } }, true);
  await settle();
  assert.equal((await jobs()).length, 0);

  // Plato → bebida: cocina solo tiene que anular
  await orderChangesService.replace(r, order.items[0].id, { ...change, quantity: 1, replacement: { menuItemId: vino.id } }, true);
  await settle();
  const [cambio] = await jobs();
  const lines = (cambio.doc as unknown as { lines: { text: string }[] }).lines.map(l => l.text);
  assert.ok(lines.some(l => l.includes('ANULAR: Milanesa')));
  assert.ok(!lines.some(l => l.includes('HACER')));
});

test('ancho de papel de 58 mm: 32 caracteres; el ejemplo usa el del local', async () => {
  const { r, order } = await setup();
  await printingService.setSettings(r, { paperWidth: 58 }, null);
  assert.deepEqual(await printingService.getSettings(r), { paperWidth: 58, printerName: null });
  const job = await printedOrder({ restaurantId: r, orderId: order.id });
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

test('cada local ve solo sus trabajos; reimprimir crea otro vinculado; reintentar y descartar solo en el propio', async () => {
  const a = await setup('Local A');
  const b = await setup('Local B');
  const jobA = await printedOrder({ restaurantId: a.r, orderId: a.order.id });
  await printedOrder({ restaurantId: b.r, orderId: b.order.id });

  assert.deepEqual((await printingService.listJobs(a.r)).map(j => j.id), [jobA.id]);
  await assert.rejects(printingService.printOrder({ restaurantId: a.r, orderId: b.order.id }), isHttp(404));
  await assert.rejects(printingService.reprint(b.r, jobA.id), isHttp(404));
  await assert.rejects(printingService.retry(b.r, jobA.id), isHttp(404));
  await assert.rejects(printingService.discard(b.r, jobA.id), isHttp(404));

  const again = await printingService.reprint(a.r, jobA.id);
  assert.equal(again.reprintOfId, jobA.id);
  assert.deepEqual(texts(again).slice(0, 4), texts(jobA).slice(0, 4));
  assert.deepEqual((await printingService.listJobs(a.r)).map(j => j.id), [again.id, jobA.id]);

  // Sin impresora elegida no se manda nada: queda pendiente (solo se ve en pantalla)
  await kickPrinter();
  assert.equal(sent.length, 0);
  const discarded = await printingService.discard(a.r, jobA.id);
  assert.equal(discarded.status, 'DISCARDED');
  await assert.rejects(printingService.discard(a.r, jobA.id), isHttp(404));
});

test('un pedido sin platos activos no se imprime', async () => {
  const { r, order } = await setup();
  await prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { status: 'VOIDED' } });
  await assert.rejects(printingService.printOrder({ restaurantId: r, orderId: order.id }), isHttp(400));
});

test('con impresora elegida: imprime en orden, con los bytes ESC/POS, y solo lo de ese local', async () => {
  const a = await setup('Local A');
  const b = await setup('Local B');
  await printingService.setSettings(a.r, { printerName: 'XP-80C' }, null);
  const first = await printedOrder({ restaurantId: a.r, orderId: a.order.id });
  const second = await printingService.printSample(a.r, 'test');
  const other = await printedOrder({ restaurantId: b.r, orderId: b.order.id });
  await kickPrinter();

  assert.deepEqual(sent.map(s => s.title), [first.title, 'Prueba de impresora']);
  assert.equal(sent[0].target, 'XP-80C');
  assert.deepEqual([...sent[0].data.subarray(0, 7)], [0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 2]);
  for (const id of [first.id, second.id]) {
    const j = await prisma.printJob.findUniqueOrThrow({ where: { id } });
    assert.equal(j.status, 'PRINTED');
    assert.ok(j.printedAt);
  }
  assert.equal((await prisma.printJob.findUniqueOrThrow({ where: { id: other.id } })).status, 'PENDING');
  const st = await printingService.status(a.r);
  assert.equal(st.printerName, 'XP-80C');
  assert.ok(st.lastOkAt);
  assert.deepEqual(st.failed, []);
  assert.equal(await prisma.auditLog.count({ where: { restaurantId: a.r, action: 'printing.settings' } }), 1);
});

test('si la impresora falla: reintenta hasta 3 veces, queda como alerta y "Reintentar" la imprime', async () => {
  const { r, order } = await setup();
  await printingService.setSettings(r, { printerName: '192.168.1.50' }, null);
  failWith = 'No se pudo imprimir en 192.168.1.50: no está en la red';
  const job = await printedOrder({ restaurantId: r, orderId: order.id });
  await kickPrinter();

  let saved = await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(saved.status, 'PENDING');
  assert.equal(saved.attempts, 1);
  assert.match(saved.error ?? '', /^Reintentando \(1 de 3\)/);
  // No reintenta antes de tiempo
  await kickPrinter();
  assert.equal((await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } })).attempts, 1);
  for (let i = 1; i < MAX_ATTEMPTS; i++) await kickPrinter(r);

  saved = await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(saved.status, 'FAILED');
  assert.equal(saved.attempts, MAX_ATTEMPTS);
  assert.equal(saved.error, failWith);
  const st = await printingService.status(r);
  assert.deepEqual(st.failed.map(j => j.id), [job.id]);
  assert.equal(st.lastError, failWith);

  failWith = null;
  const retried = await printingService.retry(r, job.id);
  assert.equal(retried.status, 'PENDING');
  assert.equal(retried.attempts, 0);
  await kickPrinter();
  assert.equal((await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'PRINTED');
  assert.equal(sent.length, 1);
  assert.deepEqual((await printingService.status(r)).failed, []);
});

test('lo que esperó más de 30 minutos no se imprime tarde; al elegir impresora se descarta lo viejo', async () => {
  const { r, order } = await setup();
  const old = await printedOrder({ restaurantId: r, orderId: order.id });
  const recent = await printedOrder({ restaurantId: r, orderId: order.id });
  await prisma.printJob.update({ where: { id: old.id }, data: { queuedAt: new Date(Date.now() - 60 * 60_000) } });

  // Al elegir la impresora: lo de hace una hora se descarta, lo reciente sale
  await printingService.setSettings(r, { printerName: 'XP-80C' }, null);
  await kickPrinter();
  assert.equal((await prisma.printJob.findUniqueOrThrow({ where: { id: old.id } })).status, 'DISCARDED');
  assert.equal((await prisma.printJob.findUniqueOrThrow({ where: { id: recent.id } })).status, 'PRINTED');

  // Con la impresora ya elegida, uno que quedó esperando 31 minutos pasa a alerta sin imprimirse
  failWith = 'apagada';
  const late = await printedOrder({ restaurantId: r, orderId: order.id });
  await kickPrinter();
  failWith = null;
  await prisma.printJob.update({ where: { id: late.id }, data: { queuedAt: new Date(Date.now() - 31 * 60_000) } });
  await kickPrinter(r);
  const saved = await prisma.printJob.findUniqueOrThrow({ where: { id: late.id } });
  assert.equal(saved.status, 'FAILED');
  assert.match(saved.error ?? '', /a tiempo/);
  assert.equal(sent.length, 1);
});

test('dirección de la impresora: IP con o sin puerto, o nombre de Windows', () => {
  assert.deepEqual(parsePrinterTarget('192.168.1.50'), { kind: 'network', host: '192.168.1.50', port: 9100 });
  assert.deepEqual(parsePrinterTarget(' tcp://10.0.0.7:9101 '), { kind: 'network', host: '10.0.0.7', port: 9101 });
  assert.deepEqual(parsePrinterTarget('XP-80C (copia 1)'), { kind: 'windows', name: 'XP-80C (copia 1)' });
});

test('impresora de red: manda los bytes al puerto y avisa si no hay nadie escuchando', async () => {
  const received: Buffer[] = [];
  const server = net.createServer((sock) => { sock.on('data', d => received.push(d)); });
  await new Promise<void>(res => server.listen(0, '127.0.0.1', () => res()));
  const port = (server.address() as net.AddressInfo).port;
  await printNetwork('127.0.0.1', port, Buffer.from([0x1b, 0x40, 0x41]));
  await new Promise(res => setTimeout(res, 50));
  assert.deepEqual([...Buffer.concat(received)], [0x1b, 0x40, 0x41]);
  await new Promise<void>(res => server.close(() => res()));
  await assert.rejects(printNetwork('127.0.0.1', port, Buffer.from('x')), /rechazó la conexión/);
});
