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
  assert.deepEqual([...arrays[0]].sort(), [...ALL_PERMISSIONS].sort());
  assert.deepEqual(arrays[1], [...SYSTEM_ROLES.WAITER.permissions]);
  assert.deepEqual(arrays[2], [...SYSTEM_ROLES.CASHIER.permissions]);
});
