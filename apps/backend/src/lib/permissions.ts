// ──────────────────────────────────────────────
// permissions.ts — Catálogo de permisos y roles de sistema
// Fuente única: el frontend lo pide por GET /api/roles/permissions.
// Si agregás un permiso acá, sumalo también al tipo Permission del frontend
// (apps/frontend/src/lib/permissions.ts).
// ──────────────────────────────────────────────
import { UserRole } from '@prisma/client';

export const PERMISSIONS = [
  { key: 'app.dashboard',       group: 'General',     label: 'Usar el panel completo',             description: 'Sin este permiso, la persona ve solo la vista móvil de toma de pedidos.' },
  { key: 'orders.create',       group: 'Servicio',    label: 'Tomar pedidos',                      description: 'Cargar pedidos en mesas y para llevar.' },
  { key: 'orders.view',         group: 'Servicio',    label: 'Ver todos los pedidos',              description: 'Listado general de pedidos.' },
  { key: 'orders.delete',       group: 'Servicio',    label: 'Anular pedidos',                     description: 'Eliminar pedidos de una mesa.' },
  { key: 'tables.operate',      group: 'Servicio',    label: 'Operar mesas',                       description: 'Abrir, pedir cuenta, cerrar y reservar mesas.' },
  { key: 'reservations.manage', group: 'Servicio',    label: 'Gestionar reservas',                 description: 'Crear, editar y cancelar reservas.' },
  { key: 'sales.charge',        group: 'Caja',        label: 'Cobrar',                             description: 'Cobrar mesas y pedidos para llevar, e imprimir la cuenta.' },
  { key: 'takeaway.cancel',     group: 'Caja',        label: 'Cancelar pedidos para llevar',       description: 'Cancelar un pedido para llevar que no se cobró.' },
  { key: 'sales.view',          group: 'Caja',        label: 'Ver ventas',                         description: 'Historial de ventas y totales del día.' },
  { key: 'reports.view',        group: 'Caja',        label: 'Ver reportes',                       description: 'Reportes de ventas, ranking de platos y exportación CSV.' },
  { key: 'menu.availability',   group: 'Carta y stock', label: 'Cambiar disponibilidad de platos', description: 'Habilitar/deshabilitar platos y marcar stock bajo o agotado.' },
  { key: 'menu.manage',         group: 'Carta y stock', label: 'Editar la carta',                  description: 'Crear, editar y borrar platos y categorías.' },
  { key: 'inventory.view',      group: 'Carta y stock', label: 'Ver inventario',                   description: 'Consultar el stock de insumos.' },
  { key: 'inventory.adjust',    group: 'Carta y stock', label: 'Ajustar stock',                    description: 'Registrar reposiciones y consumos.' },
  { key: 'inventory.manage',    group: 'Carta y stock', label: 'Editar insumos',                   description: 'Crear, editar y borrar insumos.' },
  { key: 'recipes.manage',      group: 'Carta y stock', label: 'Recetas y costos',                 description: 'Ver y editar recetas y su costo.' },
  { key: 'tables.manage',       group: 'Administración', label: 'Configurar salón',                description: 'Crear, editar y borrar mesas y secciones.' },
  { key: 'takeaway.delete',     group: 'Administración', label: 'Borrar pedidos para llevar',      description: 'Eliminar definitivamente un pedido para llevar.' },
  { key: 'staff.manage',        group: 'Administración', label: 'Gestionar personal',              description: 'Fichas del equipo.' },
  { key: 'users.manage',        group: 'Administración', label: 'Gestionar usuarios y roles',      description: 'Crear cuentas, asignar roles y definir permisos.' },
] as const;

export type Permission = typeof PERMISSIONS[number]['key'];

export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map(p => p.key);

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

/** Roles que todo restaurante tiene. ADMIN siempre recibe todos los permisos, aunque se agreguen nuevos. */
export const SYSTEM_ROLES = {
  ADMIN: { name: 'Administrador', permissions: ALL_PERMISSIONS },
  WAITER: {
    name: 'Mesero',
    permissions: ['orders.create'] as Permission[],
  },
  CASHIER: {
    name: 'Cajero',
    permissions: [
      'app.dashboard', 'orders.create', 'orders.view', 'orders.delete', 'tables.operate',
      'reservations.manage', 'sales.charge', 'takeaway.cancel', 'sales.view', 'reports.view',
      'menu.availability', 'inventory.view', 'inventory.adjust',
    ] as Permission[],
  },
} as const;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

/** Permisos efectivos de un rol: el de ADMIN tiene todos; el resto, los guardados que sigan existiendo. */
export function effectivePermissions(role: { key: string | null; permissions: unknown } | null): Permission[] {
  if (!role) return [];
  if (role.key === 'ADMIN') return ALL_PERMISSIONS;
  const raw = Array.isArray(role.permissions) ? role.permissions : [];
  return raw.filter((p): p is Permission => typeof p === 'string' && isPermission(p));
}

/** Valor de la columna legada users.role que corresponde a un rol. */
export function legacyUserRole(role: { key: string | null; permissions: unknown }): UserRole {
  if (role.key === 'ADMIN') return UserRole.ADMIN;
  return effectivePermissions(role).includes('app.dashboard') ? UserRole.STAFF : UserRole.WAITER;
}
