// ──────────────────────────────────────────────
// Versión grande de un plato: qué ve el mozo en la carta.
// ──────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inOrderCategory, largeVersionOf, orderMenu, versionNames, type VersionedDish } from '../src/shared/dish-versions.js';

const dish = (id: number, name: string, category: string, extra: Partial<VersionedDish> = {}): VersionedDish => ({
  id, name, category, enabled: true, stock: 'IN_STOCK', largeVersionId: null, ...extra,
});
const base = dish(1, 'César', 'Entradas', { largeVersionId: 2 });
const large = dish(2, 'César grande', 'Principales');
const bife = dish(3, 'Bife', 'Principales');

test('el mozo ve un solo plato, en las dos categorías y lo encuentra por los dos nombres', () => {
  const menu = [base, large, bife];
  assert.deepEqual(orderMenu(menu).map(d => d.id), [1, 3]);
  assert.equal(largeVersionOf(base, menu)?.id, 2);
  assert.ok(inOrderCategory(base, 'Entradas', menu));
  assert.ok(inOrderCategory(base, 'Principales', menu));
  assert.ok(!inOrderCategory(bife, 'Entradas', menu));
  assert.deepEqual(versionNames(base, menu), ['César', 'César grande']);
});

test('si una versión no se puede pedir, la otra queda como plato común', () => {
  const noLarge = [base, { ...large, stock: 'OUT_OF_STOCK' }];
  assert.equal(largeVersionOf(base, noLarge), null);
  assert.ok(orderMenu(noLarge).some(d => d.id === 1));

  const noBase = [{ ...base, stock: 'OUT_OF_STOCK' }, large];
  assert.equal(largeVersionOf(noBase[0], noBase), null);
  assert.ok(orderMenu(noBase).some(d => d.id === 2));

  const paused = [{ ...base, enabled: false }, large];
  assert.ok(orderMenu(paused).some(d => d.id === 2));
  assert.equal(largeVersionOf(base, [base]), null); // la grande no vino en la carta
});
