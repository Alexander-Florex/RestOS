// ──────────────────────────────────────────────
// permissions.ts — Mapeo de roles a páginas accesibles
// ──────────────────────────────────────────────
import type { UserRole } from './api';

export const ROLE_PAGES: Record<UserRole, readonly string[]> = {
  ADMIN:  ['dashboard', 'tables', 'menu', 'sales', 'inventory', 'staff', 'users', 'accounting', 'expenses'],
  STAFF:  ['tables', 'menu', 'sales'],
  WAITER: ['tables-mobile'], // solo vista móvil de toma de pedidos
};

export function canAccess(role: UserRole, page: string): boolean {
  return ROLE_PAGES[role]?.includes(page) ?? false;
}

export function defaultPageFor(role: UserRole): string {
  if (role === 'ADMIN')  return 'dashboard';
  if (role === 'WAITER') return 'tables-mobile';
  return 'tables';
}

// Etiquetas en español para mostrar el rol
export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN:  'Administrador',
  WAITER: 'Mesero',
  STAFF:  'Personal',
};
