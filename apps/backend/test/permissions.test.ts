// ──────────────────────────────────────────────
// Tests unitarios del catálogo de permisos (sin base de datos).
// ──────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserRole } from '@prisma/client';
import {
  ALL_PERMISSIONS, SYSTEM_ROLES, effectivePermissions, isPermission, legacyUserRole,
} from '../src/lib/permissions.js';

test('el Administrador tiene todos los permisos, aunque su lista guardada esté incompleta', () => {
  assert.deepEqual(effectivePermissions({ key: 'ADMIN', permissions: [] }), ALL_PERMISSIONS);
});

test('el Mesero no puede cobrar y el Cajero sí', () => {
  const mesero = effectivePermissions({ key: 'WAITER', permissions: SYSTEM_ROLES.WAITER.permissions });
  const cajero = effectivePermissions({ key: 'CASHIER', permissions: SYSTEM_ROLES.CASHIER.permissions });
  assert.equal(mesero.includes('sales.charge'), false);
  assert.equal(mesero.includes('orders.create'), true);
  assert.equal(cajero.includes('sales.charge'), true);
  assert.equal(cajero.includes('users.manage'), false);
});

test('los permisos guardados que ya no existen se ignoran', () => {
  assert.deepEqual(effectivePermissions({ key: null, permissions: ['sales.view', 'permiso.viejo', 42] }), ['sales.view']);
  assert.deepEqual(effectivePermissions({ key: null, permissions: 'no-es-un-array' }), []);
  assert.deepEqual(effectivePermissions(null), []);
});

test('la columna legada users.role se deriva del rol', () => {
  assert.equal(legacyUserRole({ key: 'ADMIN', permissions: [] }), UserRole.ADMIN);
  assert.equal(legacyUserRole({ key: null, permissions: ['app.dashboard', 'sales.view'] }), UserRole.STAFF);
  assert.equal(legacyUserRole({ key: null, permissions: ['orders.create'] }), UserRole.WAITER);
});

test('todos los permisos de los roles de sistema existen en el catálogo', () => {
  for (const role of Object.values(SYSTEM_ROLES)) {
    for (const p of role.permissions) assert.ok(isPermission(p), p);
  }
});

test('la migración de roles otorga los mismos permisos que SYSTEM_ROLES', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../prisma/migrations/20261014120000_roles_and_permissions/migration.sql', import.meta.url), 'utf8');
  const arrays = [...sql.matchAll(/JSON_ARRAY\(([\s\S]*?)\)/g)].map(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
  assert.equal(arrays.length, 3);
  // Administrador: la lista guardada en esa migración es una foto de entonces. No importa que
  // falten permisos nuevos (effectivePermissions le da todos a ADMIN); sí que no haya inventados.
  assert.ok(arrays[0].every(p => isPermission(p)), 'permisos inexistentes en la migración');
  assert.deepEqual(effectivePermissions({ key: 'ADMIN', permissions: arrays[0] }), ALL_PERMISSIONS);
  // Mesero y Cajero: lo de esa migración + lo que sumaron o quitaron las posteriores
  const { readdir } = await import('node:fs/promises');
  const dir = new URL('../prisma/migrations/', import.meta.url);
  let later = '';
  for (const name of (await readdir(dir)).filter(n => n > '20261014120000_roles_and_permissions')) {
    later += await readFile(new URL(`${name}/migration.sql`, dir), 'utf8').catch(() => '');
  }
  const finalFor = (key: string, base: string[]) => {
    const added = [...later.matchAll(new RegExp(`JSON_ARRAY_APPEND\\(\`permissions\`, '\\$', '([^']+)'\\)\\s*WHERE \`key\` = '${key}'`, 'g'))].map(m => m[1]);
    const removed = [...later.matchAll(new RegExp(`JSON_SEARCH\\(\`permissions\`, 'one', '([^']+)'\\)\\)\\)\\s*WHERE \`key\` = '${key}'`, 'g'))].map(m => m[1]);
    return [...base, ...added].filter(p => !removed.includes(p)).sort();
  };
  assert.deepEqual(finalFor('WAITER', arrays[1]), [...SYSTEM_ROLES.WAITER.permissions].sort());
  assert.deepEqual(finalFor('CASHIER', arrays[2]), [...SYSTEM_ROLES.CASHIER.permissions].sort());
});

test('la Caja no ve lo facturado y sigue pudiendo cobrar', () => {
  const cajero = effectivePermissions({ key: 'CASHIER', permissions: SYSTEM_ROLES.CASHIER.permissions });
  assert.equal(cajero.includes('sales.view'), false);
  assert.equal(cajero.includes('reports.view'), false);
  for (const p of ['sales.charge', 'sales.discount', 'cash.manage', 'orders.table'] as const) assert.ok(cajero.includes(p), p);
});
