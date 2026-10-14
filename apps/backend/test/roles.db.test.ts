// ──────────────────────────────────────────────
// Tests de roles y permisos contra MySQL real.
// Requiere la base de test levantada (ver README, "Tests").
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { Request } from 'express';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { requirePermission } from '../src/middleware/auth.js';
import { invalidateAccess, rolesService } from '../src/modules/roles/roles.service.js';
import { usersService } from '../src/modules/users/users.service.js';
import type { Permission } from '../src/lib/permissions.js';

const httpServer = http.createServer();

before(() => { initSocket(httpServer); });

after(async () => {
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  httpServer.close();
});

beforeEach(async () => {
  await prisma.restaurant.deleteMany();
  invalidateAccess();
});

async function setup() {
  const restaurant = await prisma.restaurant.create({ data: { name: 'Test' } });
  const roles = await rolesService.ensureSystemRoles(restaurant.id);
  const admin = await usersService.create(restaurant.id, {
    username: 'admin', email: 'admin@x', password: '1234', name: 'Admin', roleId: roles.ADMIN.id,
  });
  const mesero = await usersService.create(restaurant.id, {
    username: 'mesero', email: 'mesero@x', password: '1234', name: 'Mesero', roleId: roles.WAITER.id,
  });
  return { restaurant, roles, admin, mesero };
}

/** Corre el middleware y devuelve el error que pasa a next (o undefined si deja pasar). */
function runGuard(perm: Permission, user: { userId: number; restaurantId: number }): Promise<unknown> {
  const req = { user: { ...user, username: 'x', role: 'STAFF' } } as unknown as Request;
  return new Promise((resolve) => requirePermission(perm)(req, {} as never, resolve));
}

test('el Mesero no puede cobrar; el Administrador sí', async () => {
  const { restaurant, admin, mesero } = await setup();
  const denied = await runGuard('sales.charge', { userId: mesero.id, restaurantId: restaurant.id });
  assert.ok(denied instanceof HttpError && denied.statusCode === 403);
  assert.equal(await runGuard('sales.charge', { userId: admin.id, restaurantId: restaurant.id }), undefined);
});

test('un rol nuevo con permiso de cobrar habilita el cobro y sincroniza users.role', async () => {
  const { restaurant, mesero } = await setup();
  const encargado = await rolesService.create(restaurant.id, { name: 'Encargado', permissions: ['app.dashboard', 'sales.charge'] });
  const updated = await usersService.update(restaurant.id, mesero.id, -1, { roleId: encargado.id });
  assert.equal(updated.role, 'STAFF');
  assert.equal(updated.roleName, 'Encargado');
  assert.equal(await runGuard('sales.charge', { userId: mesero.id, restaurantId: restaurant.id }), undefined);
});

test('quitar un permiso al rol se aplica sin esperar a que venza el token', async () => {
  const { restaurant, roles, mesero } = await setup();
  await rolesService.update(restaurant.id, roles.WAITER.id, { permissions: ['orders.create', 'sales.charge'] });
  assert.equal(await runGuard('sales.charge', { userId: mesero.id, restaurantId: restaurant.id }), undefined);
  await rolesService.update(restaurant.id, roles.WAITER.id, { permissions: ['orders.create'] });
  const denied = await runGuard('sales.charge', { userId: mesero.id, restaurantId: restaurant.id });
  assert.ok(denied instanceof HttpError && denied.statusCode === 403);
});

test('un usuario desactivado queda afuera aunque tenga el permiso', async () => {
  const { restaurant, admin, mesero } = await setup();
  await usersService.toggleActive(restaurant.id, mesero.id, admin.id);
  const denied = await runGuard('orders.create', { userId: mesero.id, restaurantId: restaurant.id });
  assert.ok(denied instanceof HttpError && denied.statusCode === 401);
});

test('el rol Administrador no se edita y los roles de sistema no se borran', async () => {
  const { restaurant, roles } = await setup();
  await assert.rejects(rolesService.update(restaurant.id, roles.ADMIN.id, { permissions: [] }), /no se puede modificar/);
  await assert.rejects(rolesService.remove(restaurant.id, roles.CASHIER.id), /no se pueden eliminar/);
});

test('no se borra un rol con usuarios asignados', async () => {
  const { restaurant, mesero } = await setup();
  const r = await rolesService.create(restaurant.id, { name: 'Bachero', permissions: ['orders.create'] });
  await usersService.update(restaurant.id, mesero.id, -1, { roleId: r.id });
  await assert.rejects(rolesService.remove(restaurant.id, r.id), (e: unknown) => e instanceof HttpError && e.statusCode === 409);
});

test('no se puede asignar un rol de otro restaurante ni permisos inexistentes', async () => {
  const { restaurant, mesero } = await setup();
  const other = await prisma.restaurant.create({ data: { name: 'Otro' } });
  const otherRoles = await rolesService.ensureSystemRoles(other.id);
  await assert.rejects(usersService.update(restaurant.id, mesero.id, -1, { roleId: otherRoles.ADMIN.id }), /no existe/);
  await assert.rejects(rolesService.create(restaurant.id, { name: 'X', permissions: ['hacer.todo'] }), /desconocidos/);
});

test('no se puede dejar el restaurante sin administrador', async () => {
  const { restaurant, roles, admin } = await setup();
  await assert.rejects(usersService.update(restaurant.id, admin.id, -1, { roleId: roles.CASHIER.id }), /sin ningún administrador/);
});
