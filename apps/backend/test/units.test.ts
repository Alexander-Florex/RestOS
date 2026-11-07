// ──────────────────────────────────────────────
// units.test.ts — Conversión de unidades (tarea 2.1), sin base de datos
// ──────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canConvert, convertUnits, normalizeUnit, UnitError } from '../src/shared/units.js';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('entiende cómo están escritas las unidades en las planillas', () => {
  assert.equal(normalizeUnit('Grs'), 'g');
  assert.equal(normalizeUnit('grs.'), 'g');
  assert.equal(normalizeUnit('Kg'), 'kg');
  assert.equal(normalizeUnit('CC'), 'cc');
  assert.equal(normalizeUnit('Un.'), 'un');
  assert.equal(normalizeUnit('UNIDAD'), 'un');
  assert.equal(normalizeUnit('lts'), 'l');
  assert.equal(normalizeUnit('Kilógramos'), 'kg');
  assert.equal(normalizeUnit('pcs'), 'un');
  assert.equal(normalizeUnit('caja'), null); // es una presentación de compra (tarea 2.2), no una unidad
  assert.equal(normalizeUnit('cucharada'), null);
  assert.equal(normalizeUnit(''), null);
});

test('convierte dentro de cada familia', () => {
  close(convertUnits(200, 'g', 'kg'), 0.2);
  close(convertUnits(1.5, 'kg', 'g'), 1500);
  close(convertUnits(250, 'cc', 'l'), 0.25);
  close(convertUnits(1, 'l', 'ml'), 1000);
  close(convertUnits(2, 'docena', 'un'), 24);
  close(convertUnits(1, 'maple', 'un'), 30);
  close(convertUnits(15, 'un', 'maple'), 0.5);
});

test('entre familias distintas se rechaza sin equivalencia', () => {
  assert.throws(() => convertUnits(100, 'g', 'un'), UnitError);
  assert.throws(() => convertUnits(1, 'l', 'kg'), /sin una equivalencia/);
  assert.equal(canConvert('g', 'un'), false);
  assert.throws(() => convertUnits(1, 'pizca', 'g'), /No se reconoce la unidad "pizca"/);
});

test('con equivalencia del insumo (1 un = 60 g) pasa de gramos a unidades y viceversa', () => {
  const huevo = { itemUnit: 'un', eq: { qty: 60, unit: 'g' } };
  close(convertUnits(120, 'g', 'un', huevo), 2);
  close(convertUnits(0.3, 'kg', 'un', huevo), 5);
  close(convertUnits(1, 'docena', 'g', huevo), 720);
  close(convertUnits(3, 'un', 'kg', huevo), 0.18);
  assert.equal(canConvert('g', 'un', huevo), true);
  // Insumo por kg con equivalencia en unidades (1 kg = 8 un, ej. limones)
  const limon = { itemUnit: 'kg', eq: { qty: 8, unit: 'un' } };
  close(convertUnits(2, 'un', 'kg', limon), 0.25);
  // Una equivalencia que no sirve para esa conversión
  assert.throws(() => convertUnits(1, 'l', 'un', huevo), UnitError);
});
