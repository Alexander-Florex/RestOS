// ──────────────────────────────────────────────
// socket-events.test.ts — Los nombres de eventos viven en un solo archivo
// (src/shared/socket-events.ts) que comparten backend y frontend.
// ──────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SocketEvents } from '../src/shared/socket-events.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHARED_FILE = path.resolve(here, '../src/shared/socket-events.ts');
const ROOTS = [path.resolve(here, '../src'), path.resolve(here, '../../frontend/src')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

test('cada evento tiene un nombre distinto', () => {
  const values = Object.values(SocketEvents);
  assert.equal(new Set(values).size, values.length);
});

test('ningún archivo escribe a mano el nombre de un evento', () => {
  const offenders: string[] = [];
  for (const file of ROOTS.flatMap(sourceFiles)) {
    if (path.resolve(file) === SHARED_FILE) continue;
    const text = readFileSync(file, 'utf8');
    for (const name of Object.values(SocketEvents)) {
      if (text.includes(`'${name}'`) || text.includes(`"${name}"`) || text.includes(`\`${name}\``)) {
        offenders.push(`${path.relative(path.resolve(here, '../..'), file)}: ${name}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'Usá SocketEvents de src/shared/socket-events.ts');
});

test('el frontend toma los eventos del archivo compartido', () => {
  const socketTs = readFileSync(path.resolve(here, '../../frontend/src/lib/socket.ts'), 'utf8');
  assert.match(socketTs, /from '@shared\/socket-events'/);
});
