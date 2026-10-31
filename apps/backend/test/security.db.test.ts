// ──────────────────────────────────────────────
// security.db.test.ts — Seguridad de autenticación por HTTP (tarea 0.6):
// límite de intentos de login, renovación de token, token fuera de la URL,
// comprobantes privados y límites de tamaño del body.
// Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma.js';
import { buildApp } from '../src/server.js';
import { initSocket } from '../src/sockets/index.js';
import { loginLimiter } from '../src/lib/login-limiter.js';
import { invalidateAccess, rolesService } from '../src/modules/roles/roles.service.js';
import { usersService } from '../src/modules/users/users.service.js';
import { logger } from '../src/lib/logger.js';
import { errorHandler } from '../src/middleware/error.js';

const server = http.createServer(buildApp());
let base = '';

before(async () => {
  initSocket(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  server.close();
});

beforeEach(async () => {
  await prisma.restaurant.deleteMany();
  invalidateAccess();
  loginLimiter.reset();
});

async function setup(name = 'Test') {
  const restaurant = await prisma.restaurant.create({ data: { name } });
  const roles = await rolesService.ensureSystemRoles(restaurant.id);
  const admin = await usersService.create(restaurant.id, {
    username: 'admin', email: `admin@${name}`, password: 'clave-correcta', name: 'Admin', roleId: roles.ADMIN.id,
  });
  return { restaurantId: restaurant.id, admin };
}

function login(restaurantId: number, password: string, username = 'admin') {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ restaurantId, username, password }),
  });
}

async function tokenFor(restaurantId: number): Promise<string> {
  const res = await login(restaurantId, 'clave-correcta');
  assert.equal(res.status, 200);
  return ((await res.json()) as { token: string }).token;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// ── Login ──

test('login: 5 intentos fallidos bloquean la cuenta, aun con la contraseña correcta', async () => {
  const { restaurantId } = await setup();
  for (let i = 0; i < 4; i++) assert.equal((await login(restaurantId, 'mal')).status, 401);

  const fifth = await login(restaurantId, 'mal');
  assert.equal(fifth.status, 429);
  assert.ok(Number(fifth.headers.get('retry-after')) > 0);

  const correct = await login(restaurantId, 'clave-correcta');
  assert.equal(correct.status, 429);
  assert.match(((await correct.json()) as { error: string }).error, /Demasiados intentos/);
});

test('login: un usuario inexistente también cuenta (no revela si existe)', async () => {
  const { restaurantId } = await setup();
  for (let i = 0; i < 4; i++) await login(restaurantId, 'x', 'nadie');
  assert.equal((await login(restaurantId, 'x', 'nadie')).status, 429);
  // La cuenta real no se ve afectada
  assert.equal((await login(restaurantId, 'clave-correcta')).status, 200);
});

// ── Token ──

test('refresh: da un token nuevo válido; con el usuario desactivado responde 401', async () => {
  const { restaurantId, admin } = await setup();
  const token = await tokenFor(restaurantId);

  const res = await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: auth(token) });
  assert.equal(res.status, 200);
  const { token: fresh } = (await res.json()) as { token: string };
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: auth(fresh) })).status, 200);

  await prisma.user.update({ where: { id: admin.id }, data: { active: false } });
  invalidateAccess();
  assert.equal((await fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: auth(fresh) })).status, 401);
});

test('CSV: el token por query string ya no sirve; con el header sí', async () => {
  const { restaurantId } = await setup();
  const token = await tokenFor(restaurantId);
  await prisma.sale.create({
    data: { restaurantId, tableNumber: 1, total: '10.00', amount: '10.00', paymentMethod: 'CASH', closedAt: new Date() },
  });
  const qs = 'from=2000-01-01&to=2100-01-01';

  assert.equal((await fetch(`${base}/api/reports/sales.csv?${qs}&token=${token}`)).status, 401);

  const res = await fetch(`${base}/api/reports/sales.csv?${qs}`, { headers: auth(token) });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /ventas-2000-01-01-2100-01-01\.csv/);
});

// ── Comprobantes ──

test('comprobantes: privados y solo del mismo restaurante', async () => {
  const a = await setup('A');
  const b = await setup('B');
  const tokenA = await tokenFor(a.restaurantId);
  const tokenB = await tokenFor(b.restaurantId);

  const dir = path.resolve(process.cwd(), 'uploads', 'sales');
  await fs.mkdir(dir, { recursive: true });
  const filename = `test-${Date.now()}.png`;
  await fs.writeFile(path.join(dir, filename), 'imagen-de-prueba');
  try {
    const sale = await prisma.sale.create({
      data: {
        restaurantId: a.restaurantId, tableNumber: 1, total: '10.00', amount: '10.00',
        paymentMethod: 'TRANSFER', closedAt: new Date(), imageUrl: `/uploads/sales/${filename}`,
      },
    });

    // La carpeta ya no se sirve en público
    assert.equal((await fetch(`${base}/uploads/sales/${filename}`)).status, 404);
    // Sin login
    assert.equal((await fetch(`${base}/api/sales/${sale.id}/receipt`)).status, 401);
    // Otro restaurante
    assert.equal((await fetch(`${base}/api/sales/${sale.id}/receipt`, { headers: auth(tokenB) })).status, 404);
    // El propio
    const own = await fetch(`${base}/api/sales/${sale.id}/receipt`, { headers: auth(tokenA) });
    assert.equal(own.status, 200);
    assert.equal(await own.text(), 'imagen-de-prueba');
  } finally {
    await fs.rm(path.join(dir, filename), { force: true });
  }
});

// ── Body ──

test('body: más de 1 MB se rechaza con 413, salvo al registrar una venta', async () => {
  const { restaurantId } = await setup();
  const token = await tokenFor(restaurantId);
  const big = JSON.stringify({ name: 'x'.repeat(1_200_000) });
  const headers = { ...auth(token), 'Content-Type': 'application/json' };

  assert.equal((await fetch(`${base}/api/sections`, { method: 'POST', headers, body: big })).status, 413);

  // La venta lleva el comprobante en base64: el parser la deja pasar (falla después, por validación)
  const sale = await fetch(`${base}/api/sales`, { method: 'POST', headers, body: big });
  assert.equal(sale.status, 400);
});

test('body: un JSON mal formado responde 400, no 500', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"roto":',
  });
  assert.equal(res.status, 400);
});

// ── Logs y health (tarea 0.7) ──

test('health: 200 con la base respondiendo, sin exponer el entorno', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.status, 'ok');
  assert.equal(body.db, 'ok');
  assert.equal(body.env, undefined);
});

test('cada respuesta trae X-Request-Id; uno entrante inválido se reemplaza', async () => {
  const own = await fetch(`${base}/api/health`, { headers: { 'X-Request-Id': 'abc12345-proxy' } });
  assert.equal(own.headers.get('x-request-id'), 'abc12345-proxy');
  const bad = await fetch(`${base}/api/health`, { headers: { 'X-Request-Id': 'x\'; DROP' } });
  assert.match(bad.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
});

test('error 500: se registra con el código del pedido y al usuario solo le llega el código', async () => {
  const lines: string[] = [];
  const removeSink = logger.addSink({ write: (l) => lines.push(l) });
  try {
    let status = 0;
    let body: Record<string, unknown> = {};
    const res = {
      status(s: number) { status = s; return this; },
      json(b: Record<string, unknown>) { body = b; return this; },
      setHeader() { return this; },
    };
    const req = { requestId: 'deadbeef-1234-4abc-9def-000000000000', method: 'POST', path: '/api/sales', user: { userId: 9, restaurantId: 3 } };
    errorHandler(new Error('detalle interno de la base'), req as never, res as never, () => {});

    assert.equal(status, 500);
    assert.match(String(body.error), /código deadbeef/);
    assert.equal(body.message, undefined); // fuera de desarrollo no viaja el detalle

    const entry = JSON.parse(lines.find(l => l.includes('unhandled_error'))!);
    assert.equal(entry.requestId, req.requestId);
    assert.equal(entry.path, '/api/sales');
    assert.equal(entry.userId, 9);
    assert.equal(entry.error.message, 'detalle interno de la base');
  } finally {
    removeSink();
  }
});
