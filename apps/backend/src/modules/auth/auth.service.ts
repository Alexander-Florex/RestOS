// ──────────────────────────────────────────────
// auth.service.ts — Lógica de negocio de autenticación
// ──────────────────────────────────────────────
import bcrypt from 'bcryptjs';
import type { Role, User } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { signToken } from '../../lib/jwt.js';
import { HttpError } from '../../lib/http-error.js';
import { effectivePermissions, type Permission } from '../../lib/permissions.js';
import { rolesService } from '../roles/roles.service.js';

export interface SafeUser {
  id: number;
  restaurantId: number;
  username: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'WAITER' | 'STAFF';
  roleId: number;
  roleName: string;
  permissions: Permission[];
  active: boolean;
}

function toSafeUser(u: User, role: Role): SafeUser {
  return {
    id: u.id,
    restaurantId: u.restaurantId,
    username: u.username,
    email: u.email,
    name: u.name,
    role: u.role,
    roleId: role.id,
    roleName: role.name,
    permissions: effectivePermissions(role),
    active: u.active,
  };
}

/** Rol del usuario. Si no tiene uno asignado (datos previos a los roles), toma el de sistema equivalente. */
async function resolveRole(user: User & { roleRef: Role | null }): Promise<Role> {
  if (user.roleRef) return user.roleRef;
  const system = await rolesService.ensureSystemRoles(user.restaurantId);
  const role = user.role === 'ADMIN' ? system.ADMIN : user.role === 'WAITER' ? system.WAITER : system.CASHIER;
  await prisma.user.update({ where: { id: user.id }, data: { roleId: role.id } });
  return role;
}

export const authService = {
  /**
   * Login multi-tenant: el username es único por restaurante, no globalmente.
   * Por eso se requiere el restaurantId para encontrar al usuario correcto.
   */
  async login(restaurantId: number, username: string, password: string): Promise<{ user: SafeUser; token: string }> {
    const user = await prisma.user.findUnique({
      where: { restaurantId_username: { restaurantId, username } },
      include: { roleRef: true },
    });

    // Genérico para no filtrar si el usuario existe o no
    if (!user || !user.active) {
      throw HttpError.unauthorized('Usuario o contraseña incorrectos');
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      throw HttpError.unauthorized('Usuario o contraseña incorrectos');
    }

    const role = await resolveRole(user);
    const token = signToken({
      userId: user.id,
      restaurantId: user.restaurantId,
      username: user.username,
      role: user.role,
    });

    return { user: toSafeUser(user, role), token };
  },

  async getMe(userId: number, restaurantId: number): Promise<SafeUser> {
    const user = await prisma.user.findFirst({ where: { id: userId, restaurantId }, include: { roleRef: true } });
    if (!user || !user.active) throw HttpError.unauthorized('Sesión inválida');
    return toSafeUser(user, await resolveRole(user));
  },
};
