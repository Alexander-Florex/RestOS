// ──────────────────────────────────────────────
// auth.service.ts — Lógica de negocio de autenticación
// ──────────────────────────────────────────────
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { signToken } from '../../lib/jwt.js';
import { HttpError } from '../../lib/http-error.js';

export interface SafeUser {
  id: number;
  restaurantId: number;
  username: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'WAITER' | 'STAFF';
  active: boolean;
}

function toSafeUser(u: {
  id: number;
  restaurantId: number;
  username: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'WAITER' | 'STAFF';
  active: boolean;
}): SafeUser {
  return {
    id: u.id,
    restaurantId: u.restaurantId,
    username: u.username,
    email: u.email,
    name: u.name,
    role: u.role,
    active: u.active,
  };
}

export const authService = {
  /**
   * Login multi-tenant: el username es único por restaurante, no globalmente.
   * Por eso se requiere el restaurantId para encontrar al usuario correcto.
   */
  async login(restaurantId: number, username: string, password: string): Promise<{ user: SafeUser; token: string }> {
    const user = await prisma.user.findUnique({
      where: { restaurantId_username: { restaurantId, username } },
    });

    // Genérico para no filtrar si el usuario existe o no
    if (!user || !user.active) {
      throw HttpError.unauthorized('Usuario o contraseña incorrectos');
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      throw HttpError.unauthorized('Usuario o contraseña incorrectos');
    }

    const token = signToken({
      userId: user.id,
      restaurantId: user.restaurantId,
      username: user.username,
      role: user.role,
    });

    return { user: toSafeUser(user), token };
  },

  async getMe(userId: number, restaurantId: number): Promise<SafeUser> {
    const user = await prisma.user.findFirst({ where: { id: userId, restaurantId } });
    if (!user || !user.active) throw HttpError.unauthorized('Sesión inválida');
    return toSafeUser(user);
  },
};
