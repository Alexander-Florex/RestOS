// ──────────────────────────────────────────────
// planillas.test.ts — Plan del importador de planillas (tarea 2.9), sin base.
// ──────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkbooks } from '../src/lib/planillas/parse.js';
import { buildPlan } from '../src/lib/planillas/plan.js';
import { nameKey, parsePresentationText, parseYieldText } from '../src/lib/planillas/normalize.js';
import { buildFixture } from './planillas-fixture.js';

const close = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);

function plan() {
  const { costs, stock } = buildFixture();
  return buildPlan(parseWorkbooks(costs, stock));
}

test('nombres: tildes, mayúsculas, espacios y plurales no importan', () => {
  assert.equal(nameKey('Huevos '), nameKey('huevo'));
  assert.equal(nameKey('Limones'), nameKey('Limón'));
  assert.equal(nameKey('Ñoquis  de papa'), nameKey('noquis de papa'));
});

test('presentaciones escritas a mano', () => {
  assert.deepEqual(parsePresentationText('x 1kg'), { qty: 1, unit: 'kg' });
  assert.deepEqual(parsePresentationText('25 kilos'), { qty: 25, unit: 'kg' });
  assert.deepEqual(parsePresentationText('2,5 kilos (pack)'), { qty: 2.5, unit: 'kg' });
  assert.deepEqual(parsePresentationText('x 1000cc'), { qty: 1000, unit: 'cc' });
  assert.deepEqual(parsePresentationText('Maple'), { qty: 30, unit: 'un' });
  assert.deepEqual(parsePresentationText('12 un.'), { qty: 12, unit: 'un' });
  assert.equal(parsePresentationText('12 atados'), null);
  assert.equal(parsePresentationText('L'), null);
  assert.deepEqual(parseYieldText('1 litro (aprox. 4 frascos)'), { qty: 1, unit: 'l' });
  assert.equal(parseYieldText('20 porciones '), null);
});

test('presentación: manda Insumos ("25 kilos", =D5/25) y se avisa si la planilla calculaba distinto', () => {
  const p = plan();
  const harina = p.items.find(i => i.name === 'Harina 0000')!;
  assert.deepEqual(harina.presentation, { qty: 25, unit: 'kg', price: 25000 });
  close(harina.costPerUnit, 1000);
  assert.ok(p.issues.some(i => i.code === 'PRESENTACION_DISTINTA' && i.message.includes('Harina 0000')));

  const huevos = p.items.find(i => i.name === 'Huevos')!;
  assert.equal(huevos.unit, 'un');
  close(huevos.costPerUnit, 220);
  // El huevo vinculado al precio unitario (Insumos!E6) no es un error de presentación
  assert.ok(!p.issues.some(i => i.code === 'PRESENTACION_DISTINTA' && i.message.includes('Huevos')));
});

test('vínculos: "Lomo" que apuntaba a "Bife angosto" se une al insumo Lomo', () => {
  const p = plan();
  const lw = p.recipes.find(r => r.name === 'Lomo Wellington')!;
  const lomo = p.items.find(i => i.name === 'Lomo')!;
  assert.ok(lw.lines.some(l => l.kind === 'item' && l.key === lomo.key && l.quantity === 400));
  assert.ok(p.issues.some(i => i.code === 'VINCULO_A_OTRO_INSUMO'));
});

test('sub-recetas: siempre por costo, aunque la planilla apuntara al precio con IVA', () => {
  const p = plan();
  const chimi = p.recipes.find(r => r.name === 'Chimichurri')!;
  assert.equal(chimi.yieldQty, 1);
  assert.equal(chimi.yieldUnit, 'l');
  const lw = p.recipes.find(r => r.name === 'Lomo Wellington')!;
  assert.ok(lw.lines.some(l => l.kind === 'sub' && l.sheet === 'Chimichurri' && l.quantity === 50 && l.unit === 'cc'));
  assert.ok(p.issues.some(i => i.code === 'SUBRECETA_MAL_VINCULADA' && i.message.includes('precio con IVA')));
  // Sub-recetas antes que las recetas que las usan
  assert.ok(p.recipes.findIndex(r => r.sheet === 'Chimichurri') < p.recipes.findIndex(r => r.sheet === 'Lomo Wellington'));
  // Lomo 400 g × $25/g + chimichurri 50 cc × $1,5/cc + 2 huevos × $220 + harina 100 g × $1/g
  close(lw.systemUnitCost, 10000 + 75 + 440 + 100);
});

test('porciones inválidas, nombre copiado, fila sin ingrediente y hojas que no son recetas', () => {
  const p = plan();
  const emp = p.recipes.find(r => r.sheet === 'Empanadas carne')!;
  assert.equal(emp.yield, 1);
  assert.ok(p.issues.some(i => i.code === 'PORCIONES_INVALIDAS' && i.where.includes('Empanadas')));
  assert.ok(p.recipes.some(r => r.name === 'Pez gallo'));
  assert.ok(p.issues.some(i => i.code === 'NOMBRE_COPIADO' && i.message.includes('Salmon')));
  assert.ok(p.issues.some(i => i.code === 'FILA_SIN_INGREDIENTE' && i.where.includes('Lomo Wellington')));
  assert.ok(!p.recipes.some(r => r.sheet === 'Modelo' || r.sheet === 'Insumos'));
  const margins = Object.fromEntries(p.recipes.map(r => [r.sheet, r.profitPct]));
  assert.equal(margins['Lomo Wellington'], 0.48);
});

test('stock: sector y orden de la planilla; nombres parecidos se unen; sin precio se crean aparte', () => {
  const p = plan();
  const item = (n: string) => p.items.find(i => i.name === n)!;
  assert.equal(item('Lomo').areaName, 'Carnes, pescados y mariscos');
  assert.equal(item('Lomo').countOrder, 2);
  assert.equal(item('Harina 0000').areaName, 'Estanterías depósito');
  assert.equal(item('Huevos').countOrder, 2); // "Huevos Maple" ~ "Huevos"
  const bife = item('Bife de chorizo'); // no se confunde con otros cortes
  assert.equal(bife.costPerUnit, null);
  assert.equal(bife.unit, 'kg');
  assert.equal(item('lavandina').category, 'SUPPLIES');
  assert.equal(item('lavandina').unit, 'un');
  // Leche no está en la planilla de stock: queda sin sector
  assert.equal(item('Leche').areaName, null);
});
