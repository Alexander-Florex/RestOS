// ──────────────────────────────────────────────
// roles.service.ts — Roles configurables y resolución de permisos
// Los roles de sistema (Administrador, Mesero, Cajero) existen en todo
// restaurante y no se borran. Administrador tiene siempre todos los permisos.
// ──────────────────────────────────────────────
import { Prisma, type Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import {
  SYSTEM_ROLES, effectivePermissions, isPermission, legacyUserRole,
  type Permission, type SystemRoleKey,
} from '../../lib/permissions.js';

type Tx = Prisma.TransactionClient | typeof prisma;

export interface RoleDto {
  id: number;
  name: string;
  key: string | null;
  system: boolean;
  /** El rol de Administrador no se puede editar (siempre tiene todo). */
  locked: boolean;
  permissions: Permission[];
  userCount: number;
}

export interface UserAccess {
  active: boolean;
  roleId: number | null;
  roleName: string | null;
  isAdmin: boolean;
  permissions: Permission[];
}

function toDto(role: Role & { _count?: { users: number } }): RoleDto {
  return {
    id: role.id,
    name: role.name,
    key: role.key,
    system: role.key !== null,
    locked: role.key === 'ADMIN',
    permissions: effectivePermissions(role),
    userCount: role._count?.users ?? 0,
  };
}

// ── Caché corta de accesos por usuario ──
// Evita ir a la base en cada request; se invalida al cambiar roles o usuarios.
const ACCESS_TTL_MS = 15_000;
const accessCache = new Map<number, { at: number; access: UserAccess }>();

export function invalidateAccess(userId?: number) {
  if (userId === undefined) accessCache.clear();
  else accessCache.delete(userId);
}

function cleanPermissions(perms: string[]): Permission[] {
  const invalid = perms.filter(p => !isPermission(p));
  if (invalid.length) throw HttpError.badRequest(`Permisos desconocidos: ${invalid.join(', ')}`);
  return [...new Set(perms)] as Permission[];
}

export const rolesService = {
  /** Crea los roles de sistema que falten. Idempotente: se usa en el alta de restaurantes. */
  async ensureSystemRoles(restaurantId: number, tx: Tx = prisma): Promise<Record<SystemRoleKey, Role>> {
    const out = {} as Record<SystemRoleKey, Role>;
    for (const key of Object.keys(SYSTEM_ROLES) as SystemRoleKey[]) {
      const def = SYSTEM_ROLES[key];
      out[key] = await tx.role.upsert({
        where: { restaurantId_key: { restaurantId, key } },
        update: {},
        create: { restaurantId, key, name: def.name, permissions: [...def.permissions] },
      });
    }
    return out;
  },

  async list(restaurantId: number): Promise<RoleDto[]> {
    const roles = await prisma.role.findMany({
      where: { restaurantId },
      include: { _count: { select: { users: true } } },
      orderBy: [{ id: 'asc' }],
    });
    return roles.map(toDto);
  },

  async create(restaurantId: number, data: { name: string; permissions: string[] }): Promise<RoleDto> {
    const permissions = cleanPermissions(data.permissions);
    const dup = await prisma.role.findUnique({ where: { restaurantId_name: { restaurantId, name: data.name } } });
    if (dup) throw HttpError.conflict('Ya existe un rol con ese nombre');
    const role = await prisma.role.create({ data: { restaurantId, name: data.name, permissions } });
    return toDto(role);
  },

  async update(restaurantId: number, id: number, data: { name?: string; permissions?: string[] }): Promise<RoleDto> {
    const permissions = data.permissions !== undefined ? cleanPermissions(data.permissions) : undefined;

    const role = await prisma.$transaction(async (tx) => {
      const current = await tx.role.findFirst({ where: { id, restaurantId } });
      if (!current) throw HttpError.notFound('Rol no encontrado');
      if (current.key === 'ADMIN') throw HttpError.badRequest('El rol Administrador no se puede modificar');

      if (data.name !== undefined && data.name !== current.name) {
        const dup = await tx.role.findUnique({ where: { restaurantId_name: { restaurantId, name: data.name } } });
        if (dup) throw HttpError.conflict('Ya existe un rol con ese nombre');
      }

      const updated = await tx.role.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(permissions !== undefined ? { permissions } : {}),
        },
        include: { _count: { select: { users: true } } },
      });

      // Mantener sincronizada la columna legada users.role
      await tx.user.updateMany({ where: { roleId: id, restaurantId }, data: { role: legacyUserRole(updated) } });
      return updated;
    });

    invalidateAccess();
    return toDto(role);
  },

  async remove(restaurantId: number, id: number): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const current = await tx.role.findFirst({ where: { id, restaurantId }, include: { _count: { select: { users: true } } } });
      if (!current) throw HttpError.notFound('Rol no encontrado');
      if (current.key !== null) throw HttpError.badRequest('Los roles Administrador, Mesero y Cajero no se pueden eliminar');
      if (current._count.users > 0) {
        throw HttpError.conflict(`Hay ${current._count.users} usuario(s) con este rol. Asignales otro rol antes de eliminarlo.`);
      }
      await tx.role.delete({ where: { id } });
    });
    invalidateAccess();
  },

  /** Rol del restaurante por id (para asignarlo a un usuario). */
  async findForTenant(restaurantId: number, id: number, tx: Tx = prisma): Promise<Role> {
    const role = await tx.role.findFirst({ where: { id, restaurantId } });
    if (!role) throw HttpError.badRequest('El rol indicado no existe');
    return role;
  },

  /** Estado actual y permisos del usuario, desde la base (con caché corta). */
  async getAccess(userId: number, restaurantId: number): Promise<UserAccess> {
    const cached = accessCache.get(userId);
    if (cached && Date.now() - cached.at < ACCESS_TTL_MS) return cached.access;

    const user = await prisma.user.findFirst({
      where: { id: userId, restaurantId },
      select: { active: true, roleId: true, roleRef: true },
    });
    const access: UserAccess = {
      active: !!user?.active,
      roleId: user?.roleId ?? null,
      roleName: user?.roleRef?.name ?? null,
      isAdmin: user?.roleRef?.key === 'ADMIN',
      permissions: effectivePermissions(user?.roleRef ?? null),
    };
    accessCache.set(userId, { at: Date.now(), access });
    return access;
  },
};
