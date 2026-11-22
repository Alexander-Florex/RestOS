// Ponerle una nota a un plato ya cargado no tiene que sumar otro plato
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveToLine } from '../src/shared/cart-lines.js';

const cart = (...lines: Array<[string, number]>) => new Map(lines.map(([key, quantity]) => [key, { key, quantity }]));
const view = (m: Map<string, { quantity: number }>) => Object.fromEntries([...m].map(([k, l]) => [k, l.quantity]));

test('1 plato + nota: sigue siendo 1 plato, ahora con la nota', () => {
  assert.deepEqual(view(moveToLine(cart(['bife', 1]), 'bife', { key: 'bife|sin sal', quantity: 1 })), { 'bife|sin sal': 1 });
});

test('2 platos y nota para 1: quedan 1 sin nota y 1 con nota', () => {
  assert.deepEqual(view(moveToLine(cart(['bife', 2]), 'bife', { key: 'bife|sin sal', quantity: 1 })), { bife: 1, 'bife|sin sal': 1 });
});

test('2 platos y nota para los 2: una sola línea de 2', () => {
  assert.deepEqual(view(moveToLine(cart(['bife', 2]), 'bife', { key: 'bife|sin sal', quantity: 2 })), { 'bife|sin sal': 2 });
});

test('si ya había una línea con esa nota, se juntan sin perder platos', () => {
  assert.deepEqual(
    view(moveToLine(cart(['bife', 2], ['bife|sin sal', 1]), 'bife', { key: 'bife|sin sal', quantity: 1 })),
    { bife: 1, 'bife|sin sal': 2 },
  );
});

test('guardar sin escribir nada no cambia la cantidad', () => {
  assert.deepEqual(view(moveToLine(cart(['bife', 2]), 'bife', { key: 'bife', quantity: 1 })), { bife: 2 });
});

test('pedir más de los cargados suma solo la diferencia', () => {
  assert.deepEqual(view(moveToLine(cart(['bife', 1]), 'bife', { key: 'bife|sin sal', quantity: 3 })), { 'bife|sin sal': 3 });
});

test('no toca los otros platos ni el carrito original', () => {
  const before = cart(['bife', 1], ['flan', 2]);
  assert.deepEqual(view(moveToLine(before, 'bife', { key: 'bife|sin sal', quantity: 1 })), { flan: 2, 'bife|sin sal': 1 });
  assert.deepEqual(view(before), { bife: 1, flan: 2 });
});
