// ──────────────────────────────────────────────
// modifiers.db.test.ts — Personalización de platos (tarea 5.7):
// opciones por plato, precio calculado por el servidor, copia en pedido y venta.
// Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { menuService } from '../src/modules/menu/menu.service.js';
import { ordersService } from '../src/modules/orders/orders.service.js';
import { salesService } from '../src/modules/sales/sales.service.js';
import { takeawayService } from '../src/modules/takeaway/takeaway.service.js';
import { modifierLines, parseModifiers } from '../src/lib/modifiers.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
after(async () => {
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  httpServer.close();
});
beforeEach(async () => { await prisma.restaurant.deleteMany(); });

async function rejectsWith(promise: Promise<unknown>, status: number, message?: RegExp) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof HttpError, String(err));
    assert.equal(err.statusCode, status, err.message);
    if (message) assert.match(err.message, message);
    return true;
  });
}

/** Restaurante con una mesa, una César configurable y un Bife con término obligatorio. */
async function setup() {
  const restaurant = await prisma.restaurant.create({ data: { name: 'Test' } });
  const restaurantId = restaurant.id;
  const table = await prisma.table.create({ data: { restaurantId, number: 1, capacity: 4 } });
  const cesar = await prisma.menuItem.create({ data: { restaurantId, name: 'Ensalada César', category: 'mains', price: '8000.00' } });
  const bife = await prisma.menuItem.create({ data: { restaurantId, name: 'Bife de chorizo', category: 'mains', price: '15000.00' } });

  const cesarCfg = await menuService.saveOptions(restaurantId, cesar.id, [
    { name: 'Ingredientes', type: 'REMOVE', required: false, options: [
      { name: 'Croutones', priceDelta: 999, isDefault: true }, // el recargo y el default se ignoran en "sacar"
      { name: 'Parmesano', priceDelta: 0, isDefault: false },
    ] },
    { name: 'Agregados', type: 'MULTI', required: false, options: [
      { name: 'Pollo grillado', priceDelta: 2500.5, isDefault: false },
      { name: 'Huevo', priceDelta: 700, isDefault: false },
    ] },
  ]);
  const bifeCfg = await menuService.saveOptions(restaurantId, bife.id, [
    { name: 'Término', type: 'SINGLE', required: true, options: [
      { name: 'Jugoso', priceDelta: 0, isDefault: false },
      { name: 'A punto', priceDelta: 0, isDefault: false },
      { name: 'Bien cocido', priceDelta: 0, isDefault: false },
    ] },
  ]);
  const opt = (cfg: typeof cesarCfg, group: string, name: string) =>
    cfg.optionGroups.find(g => g.name === group)!.options.find(o => o.name === name)!.id;

  return {
    restaurantId, tableId: table.id, cesar, bife, cesarCfg, bifeCfg,
    croutones: opt(cesarCfg, 'Ingredientes', 'Croutones'),
    pollo: opt(cesarCfg, 'Agregados', 'Pollo grillado'),
    huevo: opt(cesarCfg, 'Agregados', 'Huevo'),
    jugoso: opt(bifeCfg, 'Término', 'Jugoso'),
    aPunto: opt(bifeCfg, 'Término', 'A punto'),
  };
}

// ── Configuración ──

test('opciones: la carta trae los grupos en orden; "sacar" ignora recargo y default', async () => {
  const { restaurantId, cesar } = await setup();
  const items = await menuService.list(restaurantId);
  const item = items.find(i => i.id === cesar.id)!;
  assert.deepEqual(item.optionGroups.map(g => g.name), ['Ingredientes', 'Agregados']);
  const croutones = item.optionGroups[0].options[0];
  assert.equal(croutones.priceDelta.toString(), '0');
  assert.equal(croutones.isDefault, false);
  assert.equal(item.optionGroups[1].options[0].priceDelta.toString(), '2500.5');
});

test('opciones: guardar de nuevo conserva los ids de lo que sigue y borra lo que se sacó', async () => {
  const { restaurantId, cesar, cesarCfg, croutones, pollo } = await setup();
  const [ingredientes, agregados] = cesarCfg.optionGroups;
  const saved = await menuService.saveOptions(restaurantId, cesar.id, [
    { id: ingredientes.id, name: 'Ingredientes', type: 'REMOVE', required: false, options: [
      { id: croutones, name: 'Croutones', priceDelta: 0, isDefault: false },
    ] },
    { id: agregados.id, name: 'Extras', type: 'MULTI', required: false, options: [
      { id: pollo, name: 'Pollo', priceDelta: 3000, isDefault: false },
    ] },
  ]);
  assert.equal(saved.optionGroups[0].id, ingredientes.id);
  assert.deepEqual(saved.optionGroups[0].options.map(o => o.id), [croutones]);
  assert.equal(saved.optionGroups[1].name, 'Extras');
  assert.equal(saved.optionGroups[1].options[0].id, pollo);
  assert.equal(await prisma.menuItemOption.count({ where: { group: { menuItemId: cesar.id } } }), 2);
});

test('opciones: reglas de la configuración', async () => {
  const { restaurantId, bife } = await setup();
  await rejectsWith(menuService.saveOptions(restaurantId, bife.id, [
    { name: 'Término', type: 'SINGLE', required: true, options: [
      { name: 'Jugoso', priceDelta: 0, isDefault: true }, { name: 'A punto', priceDelta: 0, isDefault: true },
    ] },
  ]), 400, /solo una opción/);
  await rejectsWith(menuService.saveOptions(restaurantId, bife.id, [
    { name: 'Sacar', type: 'REMOVE', required: true, options: [{ name: 'Sal', priceDelta: 0, isDefault: false }] },
  ]), 400, /no puede ser obligatorio/);
  await rejectsWith(menuService.saveOptions(restaurantId, bife.id, [
    { name: 'Vacío', type: 'MULTI', required: false, options: [] },
  ]), 400);

  const other = await prisma.restaurant.create({ data: { name: 'Otro' } });
  await rejectsWith(menuService.saveOptions(other.id, bife.id, []), 404);
});

// ── Pedido de mesa ──

test('pedido: el servidor calcula el precio con recargos y guarda la copia de lo elegido', async () => {
  const { restaurantId, tableId, cesar, croutones, pollo, huevo } = await setup();
  const order = await ordersService.create(restaurantId, {
    tableId, guestCount: 2,
    items: [{ menuItemId: cesar.id, quantity: 2, optionIds: [croutones, pollo, huevo], notes: 'aderezo aparte' }],
  });
  const [item] = order.items;
  // 8000 + 2500.50 + 700 (sacar croutones no descuenta)
  assert.equal(item.price.toString(), '11200.5');
  assert.equal(item.notes, 'aderezo aparte');
  assert.deepEqual(modifierLines(item.modifiers), ['SIN Croutones', '+ Pollo grillado', '+ Huevo']);
  assert.equal(await ordersService.getTableTotal(restaurantId, tableId), 22401);
});

test('pedido: opción de otro plato o de otro restaurante se rechaza', async () => {
  const { restaurantId, tableId, cesar, aPunto } = await setup();
  await rejectsWith(ordersService.create(restaurantId, {
    tableId, guestCount: 2, items: [{ menuItemId: cesar.id, quantity: 1, optionIds: [aPunto] }],
  }), 400, /ya no existe/);

  const other = await setup();
  await rejectsWith(ordersService.create(restaurantId, {
    tableId, guestCount: 2, items: [{ menuItemId: cesar.id, quantity: 1, optionIds: [other.pollo] }],
  }), 400, /ya no existe/);
  assert.equal(await prisma.order.count({ where: { restaurantId } }), 0);
});

test('pedido: término obligatorio; dos términos o repetidos se rechazan; con default se completa solo', async () => {
  const { restaurantId, tableId, bife, bifeCfg, jugoso, aPunto } = await setup();
  const one = (optionIds?: number[]) => ordersService.create(restaurantId, {
    tableId, guestCount: 2, items: [{ menuItemId: bife.id, quantity: 1, optionIds }],
  });
  await rejectsWith(one(), 400, /Elegí "Término"/);
  await rejectsWith(one([jugoso, aPunto]), 400, /una sola opción/);
  await rejectsWith(one([jugoso, jugoso]), 400, /repetidas/);

  // Con una opción por defecto, una pantalla que no manda opciones igual puede pedir
  const [termino] = bifeCfg.optionGroups;
  await menuService.saveOptions(restaurantId, bife.id, [{
    id: termino.id, name: 'Término', type: 'SINGLE', required: true,
    options: termino.options.map(o => ({ id: o.id, name: o.name, priceDelta: 0, isDefault: o.id === aPunto })),
  }]);
  const order = await one();
  assert.deepEqual(modifierLines(order.items[0].modifiers), ['Término: A punto']);
});

test('pedido: editar la carta después no cambia lo ya pedido', async () => {
  const { restaurantId, tableId, cesar, pollo } = await setup();
  const order = await ordersService.create(restaurantId, {
    tableId, guestCount: 2, items: [{ menuItemId: cesar.id, quantity: 1, optionIds: [pollo] }],
  });
  await menuService.saveOptions(restaurantId, cesar.id, []);
  await prisma.menuItem.update({ where: { id: cesar.id }, data: { price: '99999.00' } });

  const fresh = await ordersService.getById(restaurantId, order.id);
  assert.equal(fresh.items[0].price.toString(), '10500.5');
  assert.deepEqual(modifierLines(fresh.items[0].modifiers), ['+ Pollo grillado']);
});

// ── Cobro ──

test('cobro: el total incluye recargos y la venta separa las líneas por opciones', async () => {
  const { restaurantId, tableId, cesar, croutones, pollo } = await setup();
  await ordersService.create(restaurantId, {
    tableId, guestCount: 3,
    items: [
      { menuItemId: cesar.id, quantity: 1, optionIds: [croutones] },
      { menuItemId: cesar.id, quantity: 1 },
      { menuItemId: cesar.id, quantity: 1, optionIds: [pollo] },
    ],
  });
  // Otra ronda con la misma combinación "sin croutones": se suma a esa línea
  await ordersService.create(restaurantId, {
    tableId, items: [{ menuItemId: cesar.id, quantity: 1, optionIds: [croutones] }],
  });

  // 8000 × 3 + 10500.50 = 34500.50
  await rejectsWith(salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 34500 }), 400);
  const sale = await salesService.create(restaurantId, { tableId, paymentMethod: 'CASH', amount: 34500.5 });
  assert.equal(sale.total.toString(), '34500.5');

  const items = await prisma.saleItem.findMany({ where: { saleId: sale.id }, orderBy: { id: 'asc' } });
  const lines = items.map(i => [i.quantity, i.price.toString(), modifierLines(i.modifiers).join(' / ')]);
  assert.deepEqual(lines.sort(), [
    [1, '10500.5', '+ Pollo grillado'],
    [1, '8000', ''],
    [2, '8000', 'SIN Croutones'],
  ].sort());
});

// ── Para llevar ──

test('para llevar: precio con recargos y opciones copiadas a la venta', async () => {
  const { restaurantId, cesar, bife, huevo, jugoso } = await setup();
  const order = await takeawayService.create(restaurantId, {
    customerName: 'Ana',
    items: [
      { menuItemId: cesar.id, quantity: 2, optionIds: [huevo] },
      { menuItemId: bife.id, quantity: 1, optionIds: [jugoso], notes: 'sin sal' },
    ],
  });
  // (8000 + 700) × 2 + 15000
  assert.equal(order.total?.toString(), '32400');
  await rejectsWith(takeawayService.create(restaurantId, {
    customerName: 'Beto', items: [{ menuItemId: bife.id, quantity: 1 }],
  }), 400, /Término/);

  const { sale } = await takeawayService.pay(restaurantId, order.id, 'CARD', 32400);
  const items = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
  const bifeLine = items.find(i => i.itemName === 'Bife de chorizo')!;
  assert.equal(parseModifiers(bifeLine.modifiers)[0].option, 'Jugoso');
  assert.equal(items.find(i => i.itemName === 'Ensalada César')!.subtotal.toString(), '17400');
});
