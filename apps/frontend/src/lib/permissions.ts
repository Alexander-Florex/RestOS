// ──────────────────────────────────────────────
// permissions.ts — Permisos del usuario logueado
// La lista y los textos viven en el backend (src/lib/permissions.ts,
// GET /api/roles/permissions). Este tipo debe coincidir con esas claves.
// El backend valida todo: esto solo decide qué se muestra.
// ──────────────────────────────────────────────
import type { AuthUser } from './api';

export type Permission =
  | 'app.dashboard'
  | 'orders.create' | 'orders.view' | 'orders.delete'
  | 'tables.operate' | 'tables.manage'
  | 'reservations.manage'
  | 'sales.charge' | 'sales.view' | 'reports.view'
  | 'takeaway.cancel' | 'takeaway.delete'
  | 'menu.availability' | 'menu.manage'
  | 'inventory.view' | 'inventory.adjust' | 'inventory.manage'
  | 'recipes.manage' | 'staff.manage' | 'users.manage';

/** true si el usuario tiene el permiso. Con varios, alcanza con uno. */
export function can(user: AuthUser | null | undefined, ...perms: Permission[]): boolean {
  if (!user) return false;
  return perms.some(p => user.permissions.includes(p));
}
