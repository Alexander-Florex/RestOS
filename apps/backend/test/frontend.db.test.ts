// ──────────────────────────────────────────────
// frontend.db.test.ts — El backend sirve las pantallas en el servidor del local
// (tarea 6.1): una sola dirección para celulares y PC, sin pisar la API.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

// Build de prueba (el real lo genera Vite en apps/frontend/dist)
const dist = mkdtempSync(path.join(tmpdir(), 'restos-dist-'));
mkdirSync(path.join(dist, 'assets'));
writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(path.join(dist, 'assets', 'app-1a2b3c.js'), 'console.log(1)');
writeFileSync(path.join(dist, 'favicon.svg'), '<svg/>');
process.env.SERVE_FRONTEND = 'true';
process.env.FRONTEND_DIST = dist;

let server: http.Server;
let base = '';
before(async () => {
  const { buildApp } = await import('../src/server.js');
  server = http.createServer(buildApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  server.close();
  const { prisma } = await import('../src/lib/prisma.js');
  await prisma.$disconnect();
  rmSync(dist, { recursive: true, force: true });
});

test('la raíz y las rutas de la app devuelven index.html, sin caché', async () => {
  for (const p of ['/', '/mesas/3', '/conteo']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type') ?? '', /html/);
    assert.match(await res.text(), /id="root"/);
    assert.equal(res.headers.get('cache-control'), 'no-cache');
  }
});

test('los archivos con hash tienen caché larga; los demás estáticos se sirven', async () => {
  const js = await fetch(`${base}/assets/app-1a2b3c.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('cache-control') ?? '', /max-age=31536000.*immutable/);
  assert.equal((await fetch(`${base}/favicon.svg`)).status, 200);
});

test('la API no se tapa con index.html', async () => {
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  const missing = await fetch(`${base}/api/no-existe`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type') ?? '', /json/);
  const login = await fetch(`${base}/api/auth/me`);
  assert.equal(login.status, 401);
});

test('seguridad apta para http en la red del local (sin HTTPS todavía)', async () => {
  const res = await fetch(base + '/');
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.ok(csp.includes("default-src 'self'"), csp);
  assert.ok(!csp.includes('upgrade-insecure-requests'), 'en http rompería la carga de la app');
  assert.match(csp, /connect-src 'self' ws: wss:/);
  assert.equal(res.headers.get('strict-transport-security'), null);
});
