// ──────────────────────────────────────────────
// login-limiter.test.ts — Bloqueo temporal tras intentos fallidos
// ──────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginLimiter, loginUserKey } from '../src/lib/login-limiter.js';

function setup() {
  let t = 1_000_000;
  const limiter = createLoginLimiter({
    maxUserFailures: 5, userLockMs: 10 * 60_000, maxIpFailures: 30, ipWindowMs: 15 * 60_000,
    now: () => t,
  });
  return { limiter, advance: (ms: number) => { t += ms; } };
}

test('5 fallos seguidos bloquean al usuario 10 minutos', () => {
  const { limiter, advance } = setup();
  for (let i = 0; i < 4; i++) limiter.recordFailure('1.1.1.1', 'r1:ana');
  assert.deepEqual(limiter.check('1.1.1.1', 'r1:ana'), { allowed: true });

  limiter.recordFailure('1.1.1.1', 'r1:ana');
  const blocked = limiter.check('1.1.1.1', 'r1:ana');
  assert.equal(blocked.allowed, false);
  assert.equal(!blocked.allowed && blocked.retryAfterSec, 600);
  // Desde otra IP también está bloqueado: es la cuenta la que se protege
  assert.equal(limiter.check('2.2.2.2', 'r1:ana').allowed, false);
  // Otro usuario no se ve afectado
  assert.equal(limiter.check('1.1.1.1', 'r1:bruno').allowed, true);

  advance(10 * 60_000);
  assert.equal(limiter.check('1.1.1.1', 'r1:ana').allowed, true);
});

test('un login correcto reinicia el contador del usuario', () => {
  const { limiter } = setup();
  for (let i = 0; i < 4; i++) limiter.recordFailure('1.1.1.1', 'r1:ana');
  limiter.recordSuccess('r1:ana');
  for (let i = 0; i < 4; i++) limiter.recordFailure('1.1.1.1', 'r1:ana');
  assert.equal(limiter.check('1.1.1.1', 'r1:ana').allowed, true);
});

test('fallos espaciados más que la ventana no se acumulan', () => {
  const { limiter, advance } = setup();
  for (let i = 0; i < 4; i++) limiter.recordFailure('1.1.1.1', 'r1:ana');
  advance(10 * 60_000 + 1);
  limiter.recordFailure('1.1.1.1', 'r1:ana');
  assert.equal(limiter.check('1.1.1.1', 'r1:ana').allowed, true);
});

test('una IP que prueba muchos usuarios queda bloqueada', () => {
  const { limiter, advance } = setup();
  for (let i = 0; i < 30; i++) limiter.recordFailure('6.6.6.6', `r1:user${i}`);
  assert.equal(limiter.check('6.6.6.6', 'r1:nuevo').allowed, false);
  assert.equal(limiter.check('7.7.7.7', 'r1:nuevo').allowed, true);
  advance(15 * 60_000);
  assert.equal(limiter.check('6.6.6.6', 'r1:nuevo').allowed, true);
});

test('la clave de usuario ignora mayúsculas y separa restaurantes', () => {
  assert.equal(loginUserKey(1, ' Ana '), loginUserKey(1, 'ana'));
  assert.notEqual(loginUserKey(1, 'ana'), loginUserKey(2, 'ana'));
});
