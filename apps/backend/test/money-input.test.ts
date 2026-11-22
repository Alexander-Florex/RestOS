// Montos escritos a mano en la caja: "5.000" tiene que ser cinco mil
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoneyInput } from '../src/shared/money-input.js';

test('entiende el formato argentino', () => {
  assert.equal(parseMoneyInput('5000'), 5000);
  assert.equal(parseMoneyInput('5.000'), 5000);
  assert.equal(parseMoneyInput('$ 5.000'), 5000);
  assert.equal(parseMoneyInput('1.250.000'), 1250000);
  assert.equal(parseMoneyInput('5.000,50'), 5000.5);
  assert.equal(parseMoneyInput('5000,5'), 5000.5);
  assert.equal(parseMoneyInput('5000.50'), 5000.5);
  assert.equal(parseMoneyInput(' 750 '), 750);
});

test('lo que no se entiende no es un monto', () => {
  for (const bad of ['', 'abc', '-500', '5.00.0', '5,000,00', '5000,123', '1e5']) {
    assert.ok(Number.isNaN(parseMoneyInput(bad)), bad);
  }
});
