// ──────────────────────────────────────────────
// logger.test.ts — Logs estructurados, archivo diario y retención
// ──────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDailyFileStream, createLogger, sanitize } from '../src/lib/logger.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'restos-logs-'));
}

function write(stream: NodeJS.WritableStream, line: string) {
  return new Promise<void>((resolve, reject) => stream.write(line, (err) => (err ? reject(err) : resolve())));
}

test('sanitize tapa contraseñas y tokens y convierte errores', () => {
  const out = sanitize({
    username: 'ana', password: 'secreta', token: 'abc', headers: { Authorization: 'Bearer x' },
    error: new Error('boom'),
  }) as Record<string, any>;
  assert.equal(out.username, 'ana');
  assert.equal(out.password, '[oculto]');
  assert.equal(out.token, '[oculto]');
  assert.equal(out.headers.Authorization, '[oculto]');
  assert.equal(out.error.message, 'boom');
  assert.match(out.error.stack, /boom/);
});

test('el logger escribe una línea JSON por evento y respeta el nivel', () => {
  const lines: string[] = [];
  const logger = createLogger({ level: 'info', pretty: true, sinks: [{ write: (l) => lines.push(l) }] });
  const originalLog = console.log; const originalErr = console.error;
  console.log = () => {}; console.error = () => {};
  try {
    logger.debug('no_va');
    logger.info('venta', { saleId: 7, password: 'x' });
    logger.error('fallo', { error: new Error('boom') });
  } finally {
    console.log = originalLog; console.error = originalErr;
  }
  assert.equal(lines.length, 2);
  const venta = JSON.parse(lines[0]);
  assert.equal(venta.level, 'info');
  assert.equal(venta.event, 'venta');
  assert.equal(venta.saleId, 7);
  assert.equal(venta.password, '[oculto]');
  assert.ok(!Number.isNaN(Date.parse(venta.time)));
  assert.equal(JSON.parse(lines[1]).error.message, 'boom');
});

test('archivo diario: cambia al cambiar el día LOCAL (no el UTC)', async () => {
  const dir = tempDir();
  let now = new Date('2026-10-30T02:00:00Z'); // 29/10 23:00 en Buenos Aires
  const stream = createDailyFileStream({ dir, prefix: 'app', retentionDays: 30, now: () => now });

  await write(stream, 'a\n');
  assert.equal(path.basename(stream.currentFile()), 'app-2026-10-29.log');

  now = new Date('2026-10-30T03:30:00Z'); // 30/10 00:30 local
  await write(stream, 'b\n');
  assert.equal(path.basename(stream.currentFile()), 'app-2026-10-30.log');

  assert.equal(fs.readFileSync(path.join(dir, 'app-2026-10-29.log'), 'utf8'), 'a\n');
  assert.equal(fs.readFileSync(path.join(dir, 'app-2026-10-30.log'), 'utf8'), 'b\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('retención: borra los archivos de más de N días y no toca otros', async () => {
  const dir = tempDir();
  for (const name of ['app-2026-09-29.log', 'app-2026-09-30.log', 'app-2026-10-01.log', 'access-2026-01-01.log', 'otro.txt']) {
    fs.writeFileSync(path.join(dir, name), 'x');
  }
  const stream = createDailyFileStream({
    dir, prefix: 'app', retentionDays: 30, now: () => new Date('2026-10-30T15:00:00Z'),
  });
  await write(stream, 'hoy\n');

  const left = fs.readdirSync(dir).sort();
  // Límite: 30 días antes del 30/10 = 30/09 (se conserva); el 29/09 se borra
  assert.deepEqual(left, ['access-2026-01-01.log', 'app-2026-09-30.log', 'app-2026-10-01.log', 'app-2026-10-30.log', 'otro.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});
