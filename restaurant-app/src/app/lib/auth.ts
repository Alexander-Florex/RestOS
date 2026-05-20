// ──────────────────────────────────────────────
// auth.ts — Tipos y helpers de autenticación
// ──────────────────────────────────────────────

export type UserRole = 'admin' | 'waiter' | 'staff';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: UserRole;
  email: string;
}

const STORAGE_KEY = 'restaurant_user';

export function saveUser(user: AuthUser): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function loadUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function clearUser(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// Qué páginas puede ver cada rol
export const ROLE_PAGES: Record<UserRole, string[]> = {
  admin:  ['dashboard', 'tables', 'inventory', 'accounting', 'expenses', 'staff', 'menu', 'sales'],
  staff:  ['tables', 'menu', 'sales'],
  waiter: [], // solo vista móvil de pedidos
};

export function canAccess(role: UserRole, page: string): boolean {
  return ROLE_PAGES[role]?.includes(page) ?? false;
}
