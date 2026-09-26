import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSeedAllowed } from './seed-guard.js';

test('bloquea en producción aunque la base esté vacía', () => {
  const r = checkSeedAllowed({ nodeEnv: 'production', restaurantCount: 0, force: false });
  assert.equal(r.ok, false);
});

test('bloquea en producción aunque se pase --force', () => {
  const r = checkSeedAllowed({ nodeEnv: 'production', restaurantCount: 3, force: true });
  assert.equal(r.ok, false);
});

test('bloquea si ya hay restaurantes y no se pasa --force', () => {
  const r = checkSeedAllowed({ nodeEnv: 'development', restaurantCount: 1, force: false });
  assert.equal(r.ok, false);
});

test('bloquea si hay restaurantes y NODE_ENV no está definido', () => {
  const r = checkSeedAllowed({ nodeEnv: undefined, restaurantCount: 1, force: false });
  assert.equal(r.ok, false);
});

test('permite en desarrollo con base vacía', () => {
  const r = checkSeedAllowed({ nodeEnv: 'development', restaurantCount: 0, force: false });
  assert.equal(r.ok, true);
});

test('permite en desarrollo con datos si se pasa --force', () => {
  const r = checkSeedAllowed({ nodeEnv: 'development', restaurantCount: 2, force: true });
  assert.equal(r.ok, true);
});
