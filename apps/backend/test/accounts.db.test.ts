// ──────────────────────────────────────────────
// Cuenta corriente (tarea 5.9): la Municipalidad o la cooperativa comen, firman y pagan
// después (factura semanal) con un recargo que deciden al cobrar.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { takeawayService } from '../src/modules/takeaway/takeaway.service.js';
import { reportsService } from '../src/modules/reports/reports.service.js';
import { accountsService } from '../src/modules/accounts/accounts.service.js';
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
  const muni = await accountsService.createCustomer(r, { name: 'Municipalidad' });
  const coop = await accountsService.createCustomer(r, { name: 'Cooperativa eléctrica' });
  const dish = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Milanesa', category: 'main', price: '10000.00' } });
  let n = 0;
  /** Abre una mesa nueva con `qty` milanesas y devuelve su id. */
  const table = async (qty = 1) => {
    const t = await prisma.table.create({ data: { restaurantId: r, number: ++n } });
    await ordersService.create(r, { tableId: t.id, guestCount: 2, items: [{ menuItemId: dish.id, quantity: qty }] });
    return t.id;
  };
  /** Deja una mesa a cuenta del cliente. */
  const onAccount = async (customerId: number, qty = 1) =>
    salesService.create(r, { tableId: await table(qty), paymentMethod: 'ACCOUNT', customerId, amount: 0 });
  return { r, muni, coop, dish, table, onAccount };
}

test('a cuenta: libera la mesa, cierra los pedidos y la venta queda como deuda (no entra plata)', async () => {
  const { r, muni, table } = await setup();
  const tableId = await table(2);
  const sale = await salesService.create(r, { tableId, paymentMethod: 'ACCOUNT', customerId: muni.id, amount: 0 });
  assert.equal(sale.paymentMethod, 'ACCOUNT');
  assert.equal(sale.customerId, muni.id);
  assert.equal(Number(sale.total), 20000);
  assert.equal(Number(sale.amount), 0);
  assert.equal((await prisma.table.findUniqueOrThrow({ where: { id: tableId } })).status, 'AVAILABLE');
  assert.equal(await prisma.order.count({ where: { saleId: sale.id, status: 'PAID' } }), 1);
  // Aunque manden un monto, a cuenta no entra plata
  const other = await salesService.create(r, { tableId: await table(), paymentMethod: 'ACCOUNT', customerId: muni.id, amount: 5000 });
  assert.equal(Number(other.amount), 0);
});

test('a cuenta: exige un cliente activo del restaurante; un cliente solo va con "a cuenta"', async () => {
  const { r, muni, table } = await setup();
  await assert.rejects(salesService.create(r, { tableId: await table(), paymentMethod: 'ACCOUNT', amount: 0 }), isHttp(400));
  await accountsService.updateCustomer(r, muni.id, { active: false });
  await assert.rejects(salesService.create(r, { tableId: await table(), paymentMethod: 'ACCOUNT', customerId: muni.id, amount: 0 }), isHttp(400));
  const r2 = (await prisma.restaurant.create({ data: { name: 'Otro' } })).id;
  const foreign = await accountsService.createCustomer(r2, { name: 'Ajeno' });
  await assert.rejects(salesService.create(r, { tableId: await table(), paymentMethod: 'ACCOUNT', customerId: foreign.id, amount: 0 }), isHttp(404));
  await accountsService.updateCustomer(r, muni.id, { active: true });
  await assert.rejects(salesService.create(r, { tableId: await table(), paymentMethod: 'CASH', customerId: muni.id, amount: 10000 }), isHttp(400));
  // Para llevar no se deja a cuenta
  const dish = await prisma.menuItem.findFirstOrThrow({ where: { restaurantId: r } });
  const tk = await takeawayService.create(r, { customerName: 'Ana', items: [{ menuItemId: dish.id, quantity: 1 }] });
  await assert.rejects(takeawayService.pay(r, tk.id, 'ACCOUNT', 0), isHttp(400));
});

test('estado de cuenta: saldo por cliente y comidas agrupadas por semana (lunes a domingo)', async () => {
  const { r, muni, coop, onAccount } = await setup();
  const a = await onAccount(muni.id, 1);
  const b = await onAccount(muni.id, 2);
  await onAccount(coop.id, 1);
  // Una de la semana anterior
  await prisma.sale.update({ where: { id: a.id }, data: { closedAt: new Date(Date.now() - 7 * 86_400_000) } });

  const list = await accountsService.listCustomers(r);
  assert.equal(list.find(c => c.id === muni.id)!.balance, 30000);
  assert.equal(list.find(c => c.id === coop.id)!.balance, 10000);

  const st = await accountsService.statement(r, muni.id);
  assert.equal(st.balance, 30000);
  assert.equal(st.weeks.length, 2);
  assert.deepEqual(st.weeks.map(w => w.total), [10000, 20000]); // la más vieja primero
  assert.ok(st.weeks[1].sales.some(s => s.id === b.id));
});

test('cobro: recargo aparte, salda las comidas elegidas y no cambia las ventas', async () => {
  const { r, muni, onAccount } = await setup();
  const a = await onAccount(muni.id, 1);
  const b = await onAccount(muni.id, 2);
  const c = await onAccount(muni.id, 1);
  const pay = await accountsService.registerPayment(r, {
    customerId: muni.id, saleIds: [a.id, b.id], surchargePct: 20, paymentMethod: 'TRANSFER', userId: null,
  });
  assert.equal(Number(pay.debt), 30000);
  assert.equal(Number(pay.surcharge), 6000);
  assert.equal(Number(pay.total), 36000);
  const sa = await prisma.sale.findUniqueOrThrow({ where: { id: a.id } });
  assert.equal(sa.accountPaymentId, pay.id);
  assert.equal(Number(sa.total), 10000); // la venta original no cambia
  assert.equal((await accountsService.statement(r, muni.id)).balance, 10000); // queda c
  assert.equal((await prisma.sale.findUniqueOrThrow({ where: { id: c.id } })).accountPaymentId, null);
  assert.equal(await prisma.auditLog.count({ where: { restaurantId: r, action: 'account.payment' } }), 1);
});

test('cobro: el recargo redondea al centavo; 0 % es válido', async () => {
  const { r, muni, onAccount } = await setup();
  const a = await onAccount(muni.id, 1);
  await prisma.sale.update({ where: { id: a.id }, data: { total: '333.33' } });
  const pay = await accountsService.registerPayment(r, { customerId: muni.id, saleIds: [a.id], surchargePct: 12.5, paymentMethod: 'CASH', userId: null });
  assert.equal(Number(pay.surcharge), 41.67); // 41,666…
  assert.equal(Number(pay.total), 375);
  const b = await onAccount(muni.id, 1);
  const p0 = await accountsService.registerPayment(r, { customerId: muni.id, saleIds: [b.id], surchargePct: 0, paymentMethod: 'CASH', userId: null });
  assert.equal(Number(p0.total), 10000);
});

test('cobro: no se cobra dos veces la misma comida, ni de otro cliente, ni una venta común', async () => {
  const { r, muni, coop, onAccount, table } = await setup();
  const a = await onAccount(muni.id);
  const x = await onAccount(coop.id);
  const normal = await salesService.create(r, { tableId: await table(), paymentMethod: 'CASH', amount: 10000 });
  const base = { customerId: muni.id, surchargePct: 20, paymentMethod: 'CASH' as const, userId: null };
  await accountsService.registerPayment(r, { ...base, saleIds: [a.id] });
  await assert.rejects(accountsService.registerPayment(r, { ...base, saleIds: [a.id] }), isHttp(409));
  await assert.rejects(accountsService.registerPayment(r, { ...base, saleIds: [x.id] }), isHttp(409));
  await assert.rejects(accountsService.registerPayment(r, { ...base, saleIds: [normal.id] }), isHttp(409));
  await assert.rejects(accountsService.registerPayment(r, { ...base, saleIds: [] }), isHttp(400));
  await assert.rejects(accountsService.registerPayment(r, { ...base, paymentMethod: 'ACCOUNT', saleIds: [x.id] }), isHttp(400));
  await assert.rejects(accountsService.registerPayment(r, { ...base, surchargePct: -1, saleIds: [x.id] }), isHttp(400));
  assert.equal(await prisma.accountPayment.count({ where: { restaurantId: r } }), 1);
});

test('cobro: dos cobros a la vez de la misma semana dejan uno solo', async () => {
  const { r, muni, onAccount } = await setup();
  const a = await onAccount(muni.id);
  const b = await onAccount(muni.id);
  const base = { customerId: muni.id, saleIds: [a.id, b.id], surchargePct: 20, paymentMethod: 'CASH' as const, userId: null };
  const results = await Promise.allSettled([
    accountsService.registerPayment(r, base),
    accountsService.registerPayment(r, base),
    accountsService.registerPayment(r, { ...base, saleIds: [b.id] }),
  ]);
  const ok = results.filter(x => x.status === 'fulfilled').length;
  assert.ok(ok >= 1);
  for (const x of results) if (x.status === 'rejected') assert.ok(x.reason instanceof HttpError, String(x.reason));
  // Cada comida quedó en un solo cobro y lo cobrado suma exactamente la deuda (+ recargo)
  const pays = await prisma.accountPayment.findMany({ where: { restaurantId: r } });
  assert.equal(pays.reduce((s, p) => s + Number(p.debt), 0), 20000);
});

test('anular un cobro: las comidas vuelven a deberse; queda en auditoría con motivo', async () => {
  const { r, muni, onAccount } = await setup();
  const a = await onAccount(muni.id);
  const pay = await accountsService.registerPayment(r, { customerId: muni.id, saleIds: [a.id], surchargePct: 20, paymentMethod: 'CASH', userId: null });
  await assert.rejects(accountsService.cancelPayment(r, pay.id, ''), isHttp(400));
  await accountsService.cancelPayment(r, pay.id, 'se cargó en el cliente equivocado');
  assert.equal(await prisma.accountPayment.count({ where: { id: pay.id } }), 0);
  assert.equal((await accountsService.statement(r, muni.id)).balance, 10000);
  const log = await prisma.auditLog.findFirstOrThrow({ where: { restaurantId: r, action: 'account.payment.cancel' } });
  assert.equal(log.reason, 'se cargó en el cliente equivocado');
});

test('no se borra un cliente con comidas a cuenta (se desactiva)', async () => {
  const { r, muni, coop, onAccount } = await setup();
  await onAccount(muni.id);
  await assert.rejects(accountsService.removeCustomer(r, muni.id), isHttp(409));
  await accountsService.removeCustomer(r, coop.id);
  await assert.rejects(accountsService.createCustomer(r, { name: 'municipalidad' }), isHttp(409));
});

test('reportes: lo vendido a cuenta no suma como cobrado; el cobro entra el día que se paga, con recargo', async () => {
  const { r, muni, onAccount, table } = await setup();
  const a = await onAccount(muni.id, 2);                                             // vendido $20.000, cobrado $0
  await salesService.create(r, { tableId: await table(), paymentMethod: 'CASH', amount: 10000 }); // cobrado $10.000
  const today = localDayKey(new Date());
  let rep = await reportsService.salesReport(r, localDaysRange(today));
  assert.equal(rep.totals.totalSold, 30000);
  assert.equal(rep.totals.totalCollected, 10000);
  assert.equal(rep.byPaymentMethod.find(m => m.method === 'ACCOUNT')!.amount, 20000);
  assert.equal(rep.accountCollections.total, 0);

  await accountsService.registerPayment(r, { customerId: muni.id, saleIds: [a.id], surchargePct: 25, paymentMethod: 'TRANSFER', userId: null });
  rep = await reportsService.salesReport(r, localDaysRange(today));
  assert.equal(rep.accountCollections.count, 1);
  assert.equal(rep.accountCollections.debt, 20000);
  assert.equal(rep.accountCollections.surcharge, 5000);
  assert.equal(rep.accountCollections.total, 25000);
  assert.equal(rep.totals.totalCollected, 35000); // efectivo de hoy + cobro de cuenta corriente

  const stats = await salesService.dailyStats(r, today);
  assert.equal(stats.byMethod.ACCOUNT.amount, 20000);
});
