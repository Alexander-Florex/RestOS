// ──────────────────────────────────────────────
// Stock automático (fase 3): descuento al vender (apagado por defecto), producción de
// elaborados, mermas, lista de compras y estado del plato según el stock.
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
import { menuService } from '../src/modules/menu/menu.service.js';
import { stockAutoService } from '../src/modules/stock/stock-auto.service.js';
import { localDaysRange, localDayKey } from '../src/lib/time.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
/** Las líneas de receta frenan el borrado de insumos (Restrict): se borran primero */
async function wipe() {
  await prisma.recipeIngredient.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.restaurant.deleteMany();
}
after(async () => {
  await wipe();
  await prisma.$disconnect();
  httpServer.close();
});
beforeEach(wipe);

const isHttp = (status: number) => (err: unknown) => err instanceof HttpError && err.statusCode === status;
const qty = async (id: number) => (await prisma.inventoryItem.findUniqueOrThrow({ where: { id } })).quantity;

/**
 * Milanesa con puré: 1 receta = 4 porciones.
 *  - Carne 800 g (insumo en kg), pan rallado 200 g (en kg, 10 % de merma)
 *  - Puré (sub-receta que rinde 1 kg): papa 1,2 kg + manteca 50 g; la milanesa usa 600 g de puré
 */
async function setup(autoStock = true) {
  const r = (await prisma.restaurant.create({ data: { name: 'Test', autoStockOnSale: autoStock } })).id;
  const item = (name: string, unit: string, quantity: number, extra: object = {}) =>
    prisma.inventoryItem.create({ data: { restaurantId: r, name, unit, quantity, costPerUnit: '1000', ...extra } });
  const carne = await item('Carne', 'kg', 10);
  const pan = await item('Pan rallado', 'kg', 5, { wastePct: 0.1 });
  const papa = await item('Papa', 'kg', 20);
  const manteca = await item('Manteca', 'kg', 2);
  const dish = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Milanesa con puré', category: 'main', price: '9000.00' } });
  const sinReceta = await prisma.menuItem.create({ data: { restaurantId: r, name: 'Agua', category: 'drinks', price: '1000.00' } });
  const pure = await prisma.recipe.create({
    data: {
      restaurantId: r, name: 'Puré', yield: 5, yieldQty: 1, yieldUnit: 'kg',
      ingredients: { create: [{ inventoryItemId: papa.id, quantity: 1.2, unit: 'kg' }, { inventoryItemId: manteca.id, quantity: 50, unit: 'g' }] },
    },
  });
  await prisma.recipe.create({
    data: {
      restaurantId: r, name: 'Milanesa con puré', menuItemId: dish.id, yield: 4,
      ingredients: { create: [
        { inventoryItemId: carne.id, quantity: 800, unit: 'g' },
        { inventoryItemId: pan.id, quantity: 200, unit: 'g' },
        { subRecipeId: pure.id, quantity: 600, unit: 'g' },
      ] },
    },
  });
  let n = 0;
  const sell = async (menuItemId: number, quantity: number) => {
    const t = await prisma.table.create({ data: { restaurantId: r, number: ++n } });
    await ordersService.create(r, { tableId: t.id, guestCount: 1, items: [{ menuItemId, quantity }] });
    const dishRow = await prisma.menuItem.findUniqueOrThrow({ where: { id: menuItemId } });
    return salesService.create(r, { tableId: t.id, paymentMethod: 'CASH', amount: Number(dishRow.price) * quantity });
  };
  return { r, carne, pan, papa, manteca, dish, sinReceta, pure, sell };
}

test('apagado (por defecto): vender no toca el stock', async () => {
  const { carne, dish, sell } = await setup(false);
  await sell(dish.id, 2);
  assert.equal(await qty(carne.id), 10);
});

test('prendido: vender descuenta según la receta, con merma y sub-recetas en cascada', async () => {
  const { carne, pan, papa, manteca, dish, sell } = await setup();
  const sale = await sell(dish.id, 2); // 2 porciones = media receta
  assert.equal(await qty(carne.id), 10 - 0.4);                 // 800 g × 0,5
  assert.equal(await qty(pan.id), 5 - Math.round((0.2 / 0.9) * 0.5 * 10_000) / 10_000); // bruto con 10 % de merma
  assert.equal(await qty(papa.id), 20 - 1.2 * 0.6 * 0.5);       // 600 g de puré = 0,6 tandas
  assert.equal(await qty(manteca.id), 2 - 0.05 * 0.6 * 0.5);
  const mv = await prisma.stockMovement.findFirstOrThrow({ where: { inventoryItemId: carne.id, type: 'SALE' } });
  assert.equal(mv.reference, `Venta #${sale.id}`);
});

test('el stock puede quedar negativo: vender nunca se bloquea por falta de stock', async () => {
  const { carne, dish, sell } = await setup();
  await prisma.inventoryItem.update({ where: { id: carne.id }, data: { quantity: 0.1 } });
  await sell(dish.id, 4);
  assert.equal(await qty(carne.id), -0.7);
});

test('para llevar también descuenta; los platos sin receta aparecen en el informe', async () => {
  const { r, carne, dish, sinReceta, sell } = await setup();
  const tk = await takeawayService.create(r, { customerName: 'Ana', items: [{ menuItemId: dish.id, quantity: 4 }] });
  await takeawayService.pay(r, tk.id, 'CASH', 36000);
  assert.equal(await qty(carne.id), 10 - 0.8);
  await sell(sinReceta.id, 3);
  const rows = await stockAutoService.unrecipedSales(r, localDaysRange(localDayKey(new Date())).from, localDaysRange(localDayKey(new Date())).to);
  assert.deepEqual(rows.map(x => [x.name, x.quantity]), [['Agua', 3]]);
});

test('producción: descuenta los insumos y suma el elaborado con su costo; vender lo toma del stock', async () => {
  const { r, papa, manteca, carne, dish, pure, sell } = await setup();
  const stockPure = await prisma.inventoryItem.create({ data: { restaurantId: r, name: 'Puré (elaborado)', unit: 'kg', quantity: 0 } });
  await prisma.recipe.update({ where: { id: pure.id }, data: { stockItemId: stockPure.id } });
  const res = await stockAutoService.produce(r, pure.id, 2); // 2 kg = 2 tandas
  assert.equal(await qty(stockPure.id), 2);
  assert.equal(await qty(papa.id), 20 - 2.4);
  assert.equal(await qty(manteca.id), 2 - 0.1);
  assert.equal(res.cost, 2500);           // (2,4 + 0,1) kg × $1.000
  assert.equal(res.unitCost, 1250);
  // Ahora la milanesa usa el puré del stock, no papa y manteca
  await sell(dish.id, 4);
  assert.equal(await qty(stockPure.id), 2 - 0.6);
  assert.equal(await qty(papa.id), 20 - 2.4);
  assert.equal(await qty(carne.id), 10 - 0.8);
  await assert.rejects(stockAutoService.produce(r, pure.id, 0), isHttp(400));
});

test('merma: descuenta con motivo obligatorio', async () => {
  const { r, carne } = await setup();
  await assert.rejects(stockAutoService.waste(r, carne.id, 1, ''), isHttp(400));
  await stockAutoService.waste(r, carne.id, 1.5, 'Vencida');
  assert.equal(await qty(carne.id), 8.5);
  const mv = await prisma.stockMovement.findFirstOrThrow({ where: { inventoryItemId: carne.id, type: 'WASTE' } });
  assert.equal(mv.reason, 'Vencida');
});

test('lista de compras: bajo el mínimo, por proveedor, en presentaciones', async () => {
  const { r, carne, papa } = await setup();
  const prov = await prisma.supplier.create({ data: { restaurantId: r, name: 'Frigorífico Sur' } });
  await prisma.inventoryItem.update({ where: { id: carne.id }, data: { minStock: 15, supplierId: prov.id, purchaseQty: 5, purchaseUnit: 'kg' } });
  await prisma.inventoryItem.update({ where: { id: papa.id }, data: { minStock: 5 } }); // tiene 20: no aparece
  const groups = await stockAutoService.shoppingList(r);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].supplier!.name, 'Frigorífico Sur');
  const line = groups[0].items[0] as { name: string; suggested: number; presentations: number };
  assert.equal(line.name, 'Carne');
  assert.equal(line.suggested, 20);       // hasta el doble del mínimo: 30 − 10
  assert.equal(line.presentations, 4);    // de a 5 kg
});

test('estado del plato según el stock: agotado si no alcanza para una porción', async () => {
  const { r, carne, dish } = await setup();
  await menuService.update(r, dish.id, { stockAuto: true });
  let m = (await menuService.list(r)).find(i => i.id === dish.id)!;
  assert.equal(m.stock, 'IN_STOCK');
  await prisma.inventoryItem.update({ where: { id: carne.id }, data: { quantity: 0.5 } }); // 0,2 kg por porción → 2 porciones
  m = (await menuService.list(r)).find(i => i.id === dish.id)!;
  assert.equal(m.stock, 'LOW_STOCK');
  await prisma.inventoryItem.update({ where: { id: carne.id }, data: { quantity: 0.1 } });
  m = (await menuService.list(r)).find(i => i.id === dish.id)!;
  assert.equal(m.stock, 'OUT_OF_STOCK');
});
