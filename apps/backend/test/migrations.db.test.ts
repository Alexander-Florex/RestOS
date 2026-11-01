// ──────────────────────────────────────────────
// migrations.db.test.ts — Las migraciones arman, desde una base VACÍA,
// exactamente lo que dice schema.prisma (tarea 0.8).
//
// Si falla: alguien cambió el esquema sin migración (o al revés). Crear una
// migración nueva; nunca editar una ya aplicada en producción.
// Correr con: npm run test:db
// ──────────────────────────────────────────────
import './db-env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';

const testUrl = new URL(process.env.DATABASE_URL!);
const baseName = testUrl.pathname.replace(/^\//, '').replace(/_test$/, '');
// Termina en _test, como exige db-env: nunca puede pisar una base real
const freshName = `${baseName}_fresh_test`;
const freshUrl = new URL(testUrl.toString());
freshUrl.pathname = `/${freshName}`;

function sql(statement: string) {
  execSync('npx prisma db execute --stdin --url ' + JSON.stringify(testUrl.toString()), {
    input: statement, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

test('migrate deploy desde una base vacía deja la base igual al esquema', () => {
  sql(`DROP DATABASE IF EXISTS \`${freshName}\`; CREATE DATABASE \`${freshName}\`;`);
  try {
    execSync('npx prisma migrate deploy', {
      stdio: 'pipe', env: { ...process.env, DATABASE_URL: freshUrl.toString() },
    });

    const diff = spawnSync('npx', [
      'prisma', 'migrate', 'diff',
      '--from-url', freshUrl.toString(),
      '--to-schema-datamodel', 'prisma/schema.prisma',
      '--script',
    ], { encoding: 'utf8', shell: true });

    assert.equal(diff.status, 0, diff.stderr);
    assert.match(diff.stdout, /This is an empty migration/, `Diferencias entre migraciones y esquema:\n${diff.stdout}`);
  } finally {
    sql(`DROP DATABASE IF EXISTS \`${freshName}\`;`);
  }
});
