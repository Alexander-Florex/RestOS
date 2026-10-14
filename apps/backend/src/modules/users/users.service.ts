// ──────────────────────────────────────────────
// users.service.ts — Gestión de cuentas de login (User)
// Solo ADMIN. Maneja alta/baja/edición de usuarios del propio
// restaurante con protecciones para no dejar el sistema sin admins
// y para que un admin no se bloquee a sí mismo accidentalmente.
// ──────────────────────────────────────────────
import { UserRole, type Role, type User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';
import { env } from '../../config/env.js';
import { legacyUserRole } from '../../lib/permissions.js';
import { invalidateAccess, rolesService } from '../roles/roles.service.js';

const ROUNDS = env.BCRYPT_ROUNDS;

export type SafeUser = Omit<User, 'password'> & { roleName: string | null };

function toSafe(user: User & { roleRef?: Role | null }): SafeUser {
  const { password, roleRef, ...safe } = user;
  return { ...safe, roleName: roleRef?.name ?? null };
}

const withRole = { roleRef: true } as const;

function emitChanged(restaurantId: number, user: SafeUser) { ioRestaurant(restaurantId).emit(SocketEvents.USER_CHANGED, user); }
function emitCreated(restaurantId: number, user: SafeUser) { ioRestaurant(restaurantId).emit(SocketEvents.USER_CREATED, user); }
function emitDeleted(restaurantId: number, id: number)     { ioRestaurant(restaurantId).emit(SocketEvents.USER_DELETED, { id }); }

export interface CreateUserData {
  username: string;
  email: string;
  password: string;
  name: string;
  roleId: number;
  active?: boolean;
}

export interface UpdateUserData {
  username?: string;
  email?: string;
  password?: string;
  name?: string;
  roleId?: number;
  active?: boolean;
}

/** Cuenta cuántos admins activos hay (para no dejar el restaurante sin ninguno) */
async function countActiveAdmins(restaurantId: number, excludeId?: number): Promise<number> {
  return prisma.user.count({
    where: {
      restaurantId,
      role: UserRole.ADMIN,
      active: true,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

export const usersService = {
  async list(restaurantId: number): Promise<SafeUser[]> {
    const users = await prisma.user.findMany({
      where: { restaurantId },
      include: withRole,
      orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }],
    });
    return users.map(toSafe);
  },

  async getById(restaurantId: number, id: number): Promise<SafeUser> {
    const user = await prisma.user.findFirst({ where: { id, restaurantId }, include: withRole });
    if (!user) throw HttpError.notFound('Usuario no encontrado');
    return toSafe(user);
  },

  async create(restaurantId: number, data: CreateUserData): Promise<SafeUser> {
    const dupUsername = await prisma.user.findUnique({
      where: { restaurantId_username: { restaurantId, username: data.username } },
    });
    if (dupUsername) throw HttpError.conflict('Ya existe un usuario con ese nombre de usuario');

    const dupEmail = await prisma.user.findUnique({
      where: { restaurantId_email: { restaurantId, email: data.email } },
    });
    if (dupEmail) throw HttpError.conflict('Ya existe un usuario con ese email');

    const role = await rolesService.findForTenant(restaurantId, data.roleId);
    const hashed = await bcrypt.hash(data.password, ROUNDS);

    const user = await prisma.user.create({
      data: {
        restaurantId,
        username: data.username,
        email: data.email,
        password: hashed,
        name: data.name,
        role: legacyUserRole(role),
        roleId: role.id,
        active: data.active ?? true,
      },
      include: withRole,
    });

    const safe = toSafe(user);
    emitCreated(restaurantId, safe);
    return safe;
  },

  async update(restaurantId: number, id: number, requesterId: number, data: UpdateUserData): Promise<SafeUser> {
    const current = await prisma.user.findFirst({ where: { id, restaurantId } });
    if (!current) throw HttpError.notFound('Usuario no encontrado');

    if (data.username !== undefined && data.username !== current.username) {
      const dup = await prisma.user.findUnique({
        where: { restaurantId_username: { restaurantId, username: data.username } },
      });
      if (dup) throw HttpError.conflict('Ya existe un usuario con ese nombre de usuario');
    }

    if (data.email !== undefined && data.email !== current.email) {
      const dup = await prisma.user.findUnique({
        where: { restaurantId_email: { restaurantId, email: data.email } },
      });
      if (dup) throw HttpError.conflict('Ya existe un usuario con ese email');
    }

    const newRole = data.roleId !== undefined ? await rolesService.findForTenant(restaurantId, data.roleId) : null;
    const newLegacyRole = newRole ? legacyUserRole(newRole) : undefined;

    // Protección: no permitir quitar el rol ADMIN o desactivar al último admin activo.
    const losesAdmin = current.role === UserRole.ADMIN && (
      (newLegacyRole !== undefined && newLegacyRole !== UserRole.ADMIN) ||
      (data.active === false)
    );
    if (losesAdmin) {
      const remaining = await countActiveAdmins(restaurantId, id);
      if (remaining === 0) {
        throw HttpError.badRequest('No podés dejar el restaurante sin ningún administrador activo');
      }
    }

    // Protección: un admin no puede quitarse su propio rol de ADMIN ni desactivarse a sí mismo.
    if (id === requesterId) {
      if (current.role === UserRole.ADMIN && newLegacyRole !== undefined && newLegacyRole !== UserRole.ADMIN) {
        throw HttpError.badRequest('No podés cambiar tu propio rol de administrador');
      }
      if (data.active === false) {
        throw HttpError.badRequest('No podés desactivar tu propia cuenta');
      }
    }

    const passwordUpdate = data.password
      ? { password: await bcrypt.hash(data.password, ROUNDS) }
      : {};

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(data.username !== undefined ? { username: data.username } : {}),
        ...(data.email    !== undefined ? { email: data.email } : {}),
        ...(data.name     !== undefined ? { name: data.name } : {}),
        ...(newRole ? { roleId: newRole.id, role: newLegacyRole } : {}),
        ...(data.active   !== undefined ? { active: data.active } : {}),
        ...passwordUpdate,
      },
      include: withRole,
    });
    invalidateAccess(id);

    const safe = toSafe(user);
    emitChanged(restaurantId, safe);
    return safe;
  },

  async remove(restaurantId: number, id: number, requesterId: number): Promise<void> {
    if (id === requesterId) {
      throw HttpError.badRequest('No podés eliminar tu propia cuenta');
    }

    const current = await prisma.user.findFirst({ where: { id, restaurantId } });
    if (!current) throw HttpError.notFound('Usuario no encontrado');

    if (current.role === UserRole.ADMIN && current.active) {
      const remaining = await countActiveAdmins(restaurantId, id);
      if (remaining === 0) {
        throw HttpError.badRequest('No podés eliminar al único administrador activo');
      }
    }

    await prisma.user.delete({ where: { id } });
    invalidateAccess(id);
    emitDeleted(restaurantId, id);
  },

  async toggleActive(restaurantId: number, id: number, requesterId: number): Promise<SafeUser> {
    const current = await prisma.user.findFirst({ where: { id, restaurantId } });
    if (!current) throw HttpError.notFound('Usuario no encontrado');

    if (id === requesterId && current.active) {
      throw HttpError.badRequest('No podés desactivar tu propia cuenta');
    }

    if (current.role === UserRole.ADMIN && current.active) {
      const remaining = await countActiveAdmins(restaurantId, id);
      if (remaining === 0) {
        throw HttpError.badRequest('No podés dejar el restaurante sin ningún administrador activo');
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: { active: !current.active },
      include: withRole,
    });
    invalidateAccess(id);

    const safe = toSafe(user);
    emitChanged(restaurantId, safe);
    return safe;
  },
};
