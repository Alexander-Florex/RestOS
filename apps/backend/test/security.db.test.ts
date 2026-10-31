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
