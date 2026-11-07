// ──────────────────────────────────────────────
// costing.db.test.ts — Costos de la Fase 2: presentaciones (2.2), historial
// de precios (2.5), merma (2.4), sub-recetas (2.3), precio y margen (2.6/2.7)
// y alertas (2.8). Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { inventoryService } from '../src/modules/inventory/inventory.service.js';
import { pricing, recipesService } from '../src/modules/recipes/recipes.service.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
// Las recetas se borran primero: RecipeIngredient → InventoryItem es Restrict
async function clean() {
  // Primero las líneas: RecipeIngredient → InventoryItem y → sub-receta son Restrict
  await prisma.recipeIngredient.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.restaurant.deleteMany();
}
after(async () => {
  await clean();
  await prisma.$disconnect();
  httpServer.close();
});
beforeEach(clean);

async function restaurant() {
  return (await prisma.restaurant.create({ data: { name: 'Test' } })).id;
}

async function rejectsWith(promise: Promise<unknown>, status: number, re?: RegExp) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof HttpError, String(err));
    assert.equal(err.statusCode, status, err.message);
    if (re) assert.match(err.message, re);
    return true;
  });
}

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);
const history = (id: number) => prisma.priceHistory.findMany({ where: { inventoryItemId: id }, orderBy: { id: 'asc' } });

// ── 2.2 Presentación de compra ──

test('presentación: el costo por unidad se calcula (bolsa 25 kg a $25.000 → $1.000/kg)', async () => {
  const rid = await restaurant();
  const harina = await inventoryService.create(rid, {
    name: 'Harina', category: 'FOOD', quantity: 0, unit: 'kg',
    purchaseQty: 25, purchaseUnit: 'kg', purchasePrice: 25000,
  });
  close(Number(harina.costPerUnit), 1000);

  // Presentación en otra unidad de la misma familia: 500 g a $800 → $1.600/kg
  const queso = await inventoryService.create(rid, {
    name: 'Queso', category: 'FOOD', quantity: 0, unit: 'kg', purchaseQty: 500, purchaseUnit: 'Grs', purchasePrice: 800,
  });
  close(Number(queso.costPerUnit), 1600);
  assert.equal(queso.purchaseUnit, 'g');

  // Maple de 30 huevos a $4.500 → $150 el huevo
  const huevo = await inventoryService.create(rid, {
    name: 'Huevo', category: 'FOOD', quantity: 0, unit: 'un', purchaseQty: 1, purchaseUnit: 'maple', purchasePrice: 4500,
  });
  close(Number(huevo.costPerUnit), 150);
});

test('presentación: incompleta o en otra familia sin equivalencia se rechaza', async () => {
  const rid = await restaurant();
  await rejectsWith(inventoryService.create(rid, {
    name: 'X', category: 'FOOD', quantity: 0, unit: 'kg', purchaseQty: 25, purchasePrice: 1000,
  }), 400, /cantidad, unidad y precio/);
  await rejectsWith(inventoryService.create(rid, {
    name: 'Limón', category: 'FOOD', quantity: 0, unit: 'un', purchaseQty: 1, purchaseUnit: 'kg', purchasePrice: 2000,
  }), 400, /Presentación: .*equivalencia/);
  // Con equivalencia (1 un = 125 g → 8 por kg) sí: $2.000/kg → $250 el limón
  const limon = await inventoryService.create(rid, {
    name: 'Limón', category: 'FOOD', quantity: 0, unit: 'un', equivalenceQty: 125, equivalenceUnit: 'g',
    purchaseQty: 1, purchaseUnit: 'kg', purchasePrice: 2000,
  });
  close(Number(limon.costPerUnit), 250);
});

test('con presentación manda el precio de la presentación; sin ella, el costo a mano', async () => {
  const rid = await restaurant();
  const item = await inventoryService.create(rid, {
    name: 'Aceite', category: 'FOOD', quantity: 0, unit: 'l', purchaseQty: 5, purchaseUnit: 'l', purchasePrice: 10000,
  });
  const ignored = await inventoryService.update(rid, item.id, { costPerUnit: 1 });
  close(Number(ignored.costPerUnit), 2000);

  const cleared = await inventoryService.update(rid, item.id, { purchaseQty: null, purchaseUnit: null, purchasePrice: null, costPerUnit: 2500 });
  assert.equal(cleared.purchaseQty, null);
  close(Number(cleared.costPerUnit), 2500);
});

test('reposición en presentaciones y con precio nuevo (2 bolsas a $26.000)', async () => {
  const rid = await restaurant();
  const harina = await inventoryService.create(rid, {
    name: 'Harina', category: 'FOOD', quantity: 10, unit: 'kg', purchaseQty: 25, purchaseUnit: 'kg', purchasePrice: 25000,
  });
  const restocked = await inventoryService.restock(rid, harina.id, { presentations: 2, purchasePrice: 26000 });
  close(restocked.quantity, 60);
  close(Number(restocked.costPerUnit), 1040);
  await rejectsWith(inventoryService.restock(rid, (await inventoryService.create(rid, {
    name: 'Sal', category: 'FOOD', quantity: 0, unit: 'kg', costPerUnit: 500,
  })).id, { presentations: 1 }), 400, /no tiene presentación/);
});

// ── 2.5 Historial de precios ──

test('historial: cada cambio de costo queda registrado con su origen; sin cambio, nada', async () => {
  const rid = await restaurant();
  const item = await inventoryService.create(rid, { name: 'Leche', category: 'FOOD', quantity: 0, unit: 'l', costPerUnit: 1000 });
  await inventoryService.update(rid, item.id, { name: 'Leche entera' });            // no cambia el costo
  await inventoryService.update(rid, item.id, { costPerUnit: 1100 });                 // a mano
  await inventoryService.update(rid, item.id, { purchaseQty: 1, purchaseUnit: 'l', purchasePrice: 1200 }); // presentación
  await inventoryService.restock(rid, item.id, { presentations: 10, purchasePrice: 1250 });                 // compra

  const rows = await history(item.id);
  assert.deepEqual(rows.map(r => [r.source, Number(r.previousCost ?? 0), Number(r.costPerUnit)]), [
    ['MANUAL', 0, 1000],
    ['MANUAL', 1000, 1100],
    ['MANUAL', 1100, 1200],
    ['PURCHASE', 1200, 1250],
  ]);
  const api = await inventoryService.priceHistory(rid, item.id);
  assert.equal(Number(api[0].costPerUnit), 1250); // el más nuevo primero
});

// ── 2.4 Merma ──

test('merma: el costo usa la cantidad bruta (200 g netos con 20 % de merma = 250 g)', async () => {
  const rid = await restaurant();
  const lomo = await inventoryService.create(rid, { name: 'Lomo', category: 'FOOD', quantity: 0, unit: 'kg', costPerUnit: 10000, wastePct: 0.2 });
  const r = await recipesService.create(rid, { name: 'Lomo grillé', ingredients: [{ inventoryItemId: lomo.id, quantity: 200, unit: 'g' }] });
  close(r.cost.lines[0].grossQty, 250);
  close(r.cost.costTotal, 2500);
  // La línea puede pisar la merma del insumo (ej. corte ya limpio)
  const limpio = await recipesService.create(rid, { name: 'Lomo limpio', ingredients: [{ inventoryItemId: lomo.id, quantity: 200, unit: 'g', wastePct: 0 }] });
  close(limpio.cost.costTotal, 2000);
  await rejectsWith(recipesService.create(rid, { name: 'X', ingredients: [{ inventoryItemId: lomo.id, quantity: 1, unit: 'g', wastePct: 0.99 }] }), 400, /merma/);
});

// ── 2.3 Sub-recetas ──

async function chimichurriSetup() {
  const rid = await restaurant();
  const aceite = await inventoryService.create(rid, { name: 'Aceite', category: 'FOOD', quantity: 0, unit: 'l', costPerUnit: 4000 });
  const bife = await inventoryService.create(rid, { name: 'Bife', category: 'FOOD', quantity: 0, unit: 'kg', costPerUnit: 12000 });
  // Rinde 500 cc y 10 porciones; margen alto a propósito: su precio de venta NO se usa
  const chimi = await recipesService.create(rid, {
    name: 'Chimichurri', yield: 10, yieldQty: 500, yieldUnit: 'cc', profitPct: 3,
    ingredients: [{ inventoryItemId: aceite.id, quantity: 1, unit: 'l' }],
  });
  return { rid, aceite, bife, chimi };
}

test('sub-receta por rendimiento: 30 cc de un chimichurri de $4.000 que rinde 500 cc = $240', async () => {
  const { rid, bife, chimi } = await chimichurriSetup();
  close(chimi.cost.costPerYieldUnit!, 8);
  const plato = await recipesService.create(rid, {
    name: 'Bife con chimichurri', ingredients: [
      { inventoryItemId: bife.id, quantity: 300, unit: 'g' },
      { subRecipeId: chimi.id, quantity: 30, unit: 'cc' },
    ],
  });
  const sub = plato.cost.lines.find(l => l.kind === 'subrecipe')!;
  close(sub.cost!, 240); // costo por unidad de rendimiento, nunca el precio de venta
  close(plato.cost.costTotal, 3600 + 240);
});

test('sub-receta por porción y recálculo en cascada al subir un insumo', async () => {
  const { rid, aceite, chimi } = await chimichurriSetup();
  const plato = await recipesService.create(rid, {
    name: 'Provoleta', ingredients: [{ subRecipeId: chimi.id, quantity: 1, unit: 'porción' }],
  });
  assert.equal(plato.ingredients[0].unit, 'porcion');
  close(plato.cost.costTotal, 400); // $4.000 / 10 porciones

  await inventoryService.update(rid, aceite.id, { costPerUnit: 5000 });
  close((await recipesService.getById(rid, plato.id)).cost.costTotal, 500);
});

test('sub-recetas: ciclos, sin rendimiento y borrado en uso se rechazan', async () => {
  const { rid, aceite, chimi } = await chimichurriSetup();
  const salsa = await recipesService.create(rid, {
    name: 'Salsa', yieldQty: 1, yieldUnit: 'l', ingredients: [{ subRecipeId: chimi.id, quantity: 100, unit: 'ml' }],
  });
  // Chimichurri → Salsa → Chimichurri
  await rejectsWith(recipesService.update(rid, chimi.id, {
    ingredients: [{ inventoryItemId: aceite.id, quantity: 1, unit: 'l' }, { subRecipeId: salsa.id, quantity: 10, unit: 'ml' }],
  }), 400, /ciclo de sub-recetas: Chimichurri → Salsa → Chimichurri/);
  await rejectsWith(recipesService.update(rid, salsa.id, { ingredients: [{ subRecipeId: salsa.id, quantity: 1, unit: 'porcion' }] }), 400, /a sí misma/);

  const sinRend = await recipesService.create(rid, { name: 'Base', ingredients: [{ inventoryItemId: aceite.id, quantity: 1, unit: 'l' }] });
  await rejectsWith(recipesService.create(rid, { name: 'Y', ingredients: [{ subRecipeId: sinRend.id, quantity: 10, unit: 'cc' }] }), 400, /rendimiento/);
  await rejectsWith(recipesService.create(rid, { name: 'Z', ingredients: [{ subRecipeId: chimi.id, quantity: 10, unit: 'g' }] }), 400, /rinde en cc/);

  await rejectsWith(recipesService.remove(rid, chimi.id), 409, /Se usa como sub-receta en: Salsa/);
  await rejectsWith(recipesService.update(rid, chimi.id, { yieldQty: 1, yieldUnit: 'kg' }), 400, /Salsa.*compatible/);
});

// ── 2.6 Precio y margen (fórmula del cliente) ──

test('fórmula del cliente: precio = costo / (1 − margen); con IVA × 1,21; costo de mercadería = 1 − margen', () => {
  const p = pricing(1000, 0.6, 0.21, null);
  close(p.suggestedPriceNet!, 2500);
  close(p.suggestedPrice!, 3025);
  close(p.foodCostPct, 0.4);
  // Ejemplo de las planillas: margen 44 % → costo de mercadería 56 %
  close(pricing(560, 0.44, 0.21, null).foodCostPct, 0.56);
  // Margen real con el precio de la carta (con IVA): $3.630 → $3.000 sin IVA → 66,7 %
  const real = pricing(1000, 0.6, 0.21, 3630);
  close(real.actualMargin!, 2 / 3);
  assert.equal(real.belowTarget, false);
  assert.equal(pricing(1000, 0.7, 0.21, 3630).belowTarget, true);
  assert.equal(pricing(1000, 1, 0.21, null).suggestedPrice, null); // margen inválido: no se inventa un precio
});

test('margen objetivo de la categoría y costo/margen de cada plato de la carta (2.7)', async () => {
  const { rid, bife, chimi } = await chimichurriSetup();
  await prisma.menuCategory.create({ data: { restaurantId: rid, name: 'Parrilla', targetMargin: 0.7 } });
  const plato = await prisma.menuItem.create({ data: { restaurantId: rid, name: 'Bife', category: 'Parrilla', price: '9000.00' } });
  const r = await recipesService.create(rid, {
    name: 'Bife', menuItemId: plato.id, ingredients: [
      { inventoryItemId: bife.id, quantity: 300, unit: 'g' },          // $3.600
      { subRecipeId: chimi.id, quantity: 30, unit: 'cc' },             // $240
    ],
  });
  close(r.profitPct, 0.7); // tomó el objetivo de la categoría
  close(r.cost.costPerServing, 3840);
  close(r.cost.suggestedPrice!, 3840 / 0.3 * 1.21); // $15.488
  // $9.000 con IVA → $7.438 sin IVA → margen real 48,4 %: por debajo del 70 %
  const [c] = await recipesService.menuCosts(rid);
  assert.equal(c.menuItemId, plato.id);
  close(c.actualMargin!, 1 - 3840 / (9000 / 1.21));
  assert.equal(c.belowTarget, true);
});

// ── 2.8 Alertas de costos ──

test('alertas: sube un insumo y avisa qué platos pierden margen (también vía sub-receta)', async () => {
  const { rid, aceite, chimi } = await chimichurriSetup();
  const plato = await prisma.menuItem.create({ data: { restaurantId: rid, name: 'Provoleta', category: 'Entradas', price: '2420.00' } });
  await recipesService.create(rid, {
    name: 'Provoleta', menuItemId: plato.id, profitPct: 0.5,
    ingredients: [{ subRecipeId: chimi.id, quantity: 2, unit: 'porcion' }], // 2 × $400 = $800
  });
  assert.deepEqual(await recipesService.costAlerts(rid), []); // nada subió todavía

  await inventoryService.update(rid, aceite.id, { costPerUnit: 6000 }); // +50 %
  const [alert] = await recipesService.costAlerts(rid);
  assert.equal(alert.itemName, 'Aceite');
  close(alert.changePct, 0.5);
  assert.deepEqual(alert.otherRecipes, ['Chimichurri']);
  const [dish] = alert.dishes;
  assert.equal(dish.menuItemName, 'Provoleta');
  close(dish.costBefore, 800);
  close(dish.costNow, 1200);
  close(dish.previousMargin!, 1 - 800 / 2000);   // 60 %
  close(dish.currentMargin!, 1 - 1200 / 2000);   // 40 %
  assert.equal(dish.belowTarget, true);
  close(dish.suggestedPrice!, 1200 / 0.5 * 1.21); // $2.904 restablece el 50 %

  // Una baja de precio no genera alerta
  await inventoryService.update(rid, aceite.id, { costPerUnit: 3000 });
  assert.deepEqual(await recipesService.costAlerts(rid), []);
});

test('alertas: cargar el precio de un insumo que estaba en $0 no es una suba', async () => {
  const { rid, aceite } = await chimichurriSetup();
  await prisma.inventoryItem.update({ where: { id: aceite.id }, data: { costPerUnit: 0 } });
  await prisma.priceHistory.deleteMany({ where: { inventoryItemId: aceite.id } });
  await inventoryService.update(rid, aceite.id, { costPerUnit: 4000 }); // $0 → $4.000
  assert.deepEqual(await recipesService.costAlerts(rid), []);
  await inventoryService.update(rid, aceite.id, { costPerUnit: 5000 }); // esta sí es suba
  const [alert] = await recipesService.costAlerts(rid);
  close(alert.previousCost, 4000);
});
