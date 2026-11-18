// ──────────────────────────────────────────────
// Reportes de la fase 4: rentabilidad y análisis de menú, real vs teórico,
// cierre del día y panel del dueño.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { analyticsService } from '../src/modules/reports/analytics.service.js';
import { localDayKey, localDaysRange } from '../src/lib/time.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
async function wipe() {
  await prisma.recipeIngredient.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.restaurant.deleteMany();
}
after(async () => { await wipe(); await prisma.$disconnect(); httpServer.close(); });
beforeEach(wipe);

const today = () => localDayKey(new Date());

/** Dos platos: Bife (caro de hacer) y Pasta (barata). Insumos a $1.000 / kg. */
async function setup() {
  const r = (await prisma.restaurant.create({ data: { name: 'Test' } })).id;
  const carne = await prisma.inventoryItem.create({ data: { restaurantId: r, name: 'Carne', unit: 'kg', quantity: 0, costPerUnit: '10000' } });
  const harina = await prisma.inventoryItem.create({ data: { restaurantId: r, name: 'Harina', unit: 'kg', quantity: 0, costPerUnit: '1000' } });
  const bife = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Bife', category: 'main', price: '12100.00' } });
  const pasta = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Pasta', category: 'main', price: '6050.00' } });
  const agua = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Agua', category: 'drinks', price: '1210.00' } });
  await prisma.recipe.create({ data: { restaurantId: r, name: 'Bife', menuItemId: bife.id, yield: 1, ingredients: { create: [{ inventoryItemId: carne.id, quantity: 400, unit: 'g' }] } } });
  await prisma.recipe.create({ data: { restaurantId: r, name: 'Pasta', menuItemId: pasta.id, yield: 1, ingredients: { create: [{ inventoryItemId: harina.id, quantity: 200, unit: 'g' }] } } });
  let n = 0;
  const sell = async (items: Array<[number, number]>, opts: { method?: 'CASH' | 'CARD'; discountPct?: number; amount?: number } = {}) => {
    const t = await prisma.table.create({ data: { restaurantId: r, number: ++n } });
    await ordersService.create(r, { tableId: t.id, guestCount: 1, items: items.map(([menuItemId, quantity]) => ({ menuItemId, quantity })) });
    return salesService.create(r, {
      tableId: t.id, paymentMethod: opts.method ?? 'CASH', amount: opts.amount ?? 1_000_000,
      ...(opts.discountPct ? { discountPct: opts.discountPct, discountReason: 'promo' } : {}),
    });
  };
  return { r, carne, harina, bife, pasta, agua, sell };
}

test('rentabilidad: ingreso sin IVA, costo por receta, margen y clasificación', async () => {
  const { r, bife, pasta, agua, sell } = await setup();
  await sell([[bife.id, 1], [pasta.id, 10], [agua.id, 2]]);
  const { from, to } = localDaysRange(today());
  const rep = await analyticsService.profitability(r, from, to);
  const b = rep.dishes.find(d => d.name === 'Bife')!;
  assert.equal(b.revenueNet, 10000);       // 12.100 / 1,21
  assert.equal(b.cost, 4000);              // 0,4 kg × $10.000
  assert.equal(b.profit, 6000);
  assert.equal(b.marginPct, 60);
  const p = rep.dishes.find(d => d.name === 'Pasta')!;
  assert.equal(p.profit, 10 * (5000 - 200));
  // Pasta vende mucho y deja menos por plato que el promedio → caballo de batalla; bife: enigma
  assert.equal(p.class, 'PLOWHORSE');
  assert.equal(b.class, 'PUZZLE');
  assert.equal(rep.dishes.find(d => d.name === 'Agua')!.hasRecipe, false);
  assert.equal(rep.totals.withoutRecipe, 1);
});

test('rentabilidad: el descuento de la venta baja el ingreso del plato en proporción', async () => {
  const { r, bife, sell } = await setup();
  await sell([[bife.id, 1]], { discountPct: 10 });
  const { from, to } = localDaysRange(today());
  const b = (await analyticsService.profitability(r, from, to)).dishes[0];
  assert.equal(b.revenue, 10890);
});

test('real vs teórico: entre dos conteos, la diferencia es lo que falta y su valor', async () => {
  const { r, carne, bife, sell } = await setup();
  const at = (ms: number) => new Date(Date.now() - ms);
  // Saldo inicial 10 kg (ayer), compra 5 kg hoy, conteo final 12 kg
  const mv = (type: 'ADJUSTMENT' | 'PURCHASE' | 'COUNT', quantity: number, balanceAfter: number, createdAt: Date) =>
    prisma.stockMovement.create({ data: { restaurantId: r, inventoryItemId: carne.id, type, quantity, balanceAfter, createdAt } });
  await mv('ADJUSTMENT', 10, 10, at(36 * 3600_000));
  const from = at(24 * 3600_000);
  await mv('PURCHASE', 5, 15, at(3600_000));
  await sell([[bife.id, 5]]);                 // teórico: 5 × 0,4 = 2 kg
  await mv('COUNT', -3, 12, new Date());      // real: 10 + 5 − 12 = 3 kg
  const rep = await analyticsService.theoreticalVsReal(r, from, new Date(Date.now() + 1000));
  const c = rep.items.find(i => i.name === 'Carne')!;
  assert.equal(c.theoretical, 2);
  assert.equal(c.real, 3);
  assert.equal(c.difference, 1);
  assert.equal(c.differenceValue, 10000);
});

test('cierre del día: medios de pago, ticket promedio, descuentos y anulaciones', async () => {
  const { r, pasta, sell } = await setup();
  await sell([[pasta.id, 2]]);                              // $12.100 efectivo
  await sell([[pasta.id, 1]], { method: 'CARD', discountPct: 10, amount: 5445 }); // $5.445 tarjeta
  const t = await prisma.table.create({ data: { restaurantId: r, number: 99 } });
  const o = await ordersService.create(r, { tableId: t.id, guestCount: 1, items: [{ menuItemId: pasta.id, quantity: 1 }] });
  await ordersService.cancel(r, o.id, { reason: 'se fueron' });
  const d = await analyticsService.dailyClose(r, today());
  assert.equal(d.salesCount, 2);
  assert.equal(d.byMethod.CASH, 12100);
  assert.equal(d.byMethod.CARD, 5445);
  assert.equal(d.sold, 17545);
  assert.equal(d.averageTicket, 8772.5);
  assert.equal(d.discounts.total, 605);
  assert.equal(d.cancelledOrders.count, 1);
  assert.equal(d.cancelledOrders.total, 6050);
  const csv = await analyticsService.dailyCloseCsv(r, today());
  assert.match(csv, /Efectivo;12100,00/);
});

test('panel del dueño: hoy contra el mismo día de la semana pasada, stock bajo y margen bajo', async () => {
  const { r, carne, bife, sell } = await setup();
  await prisma.inventoryItem.update({ where: { id: carne.id }, data: { minStock: 5 } });
  await prisma.recipe.updateMany({ where: { restaurantId: r, name: 'Bife' }, data: { profitPct: 0.9 } }); // objetivo 90 %: queda bajo
  await sell([[bife.id, 1]]);
  const o = await analyticsService.owner(r);
  assert.equal(o.today.sold, 12100);
  assert.equal(o.lowStock.count, 1);
  assert.equal(o.lowMargin[0].name, 'Bife');
  assert.equal(o.cash.open, false);
});
