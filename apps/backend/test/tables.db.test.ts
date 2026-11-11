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
