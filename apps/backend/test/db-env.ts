// ──────────────────────────────────────────────
// db-env.ts — Entorno para tests de integración contra MySQL
//
// Importar PRIMERO en cada test de base (antes que cualquier módulo de src/),
// así lib/prisma.ts y config/env.ts ven estas variables.
//
// Usa TEST_DATABASE_URL (por defecto el contenedor restos-test-db, puerto 3307)
// y se niega a correr si la base no termina en "_test": los tests borran datos.
// ──────────────────────────────────────────────
import { execSync } from 'node:child_process';

const url = process.env.TEST_DATABASE_URL ?? 'mysql://root:test@localhost:3307/restos_test';
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.endsWith('_test')) {
  throw new Error(`TEST_DATABASE_URL debe apuntar a una base *_test (recibí "${dbName}"). Los tests borran datos.`);
}

process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-de-al-menos-treinta-y-dos-caracteres';

// Aplicar migraciones (idempotente). Es lo mismo que se corre en producción.
execSync('npx prisma migrate deploy', {
  stdio: 'pipe',
  env: { ...process.env, DATABASE_URL: url },
});
