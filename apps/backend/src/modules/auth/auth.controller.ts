// ──────────────────────────────────────────────
// auth.controller.ts — Handlers HTTP para auth
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authService } from './auth.service.js';
import { HttpError } from '../../lib/http-error.js';
import { loginLimiter, loginUserKey } from '../../lib/login-limiter.js';
import { logger } from '../../lib/logger.js';

const loginSchema = z.object({
  restaurantId: z.coerce.number().int().positive('restaurantId requerido'),
  username: z.string().min(1, 'Usuario requerido').max(100).trim(),
  password: z.string().min(1, 'Contraseña requerida').max(200),
});

function tooMany(retryAfterSec: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return HttpError.tooManyRequests(
    `Demasiados intentos fallidos. Probá de nuevo en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`,
    retryAfterSec,
  );
}

export const authController = {
  async login(req: Request, res: Response) {
    const { restaurantId, username, password } = loginSchema.parse(req.body);
    const ip = req.ip ?? 'unknown';
    const userKey = loginUserKey(restaurantId, username);

    // Se chequea ANTES de comparar la contraseña: bloqueado, ni la correcta entra
    const limit = loginLimiter.check(ip, userKey);
    if (!limit.allowed) throw tooMany(limit.retryAfterSec);

    try {
      const { user, token } = await authService.login(restaurantId, username, password);
      loginLimiter.recordSuccess(userKey);
      res.json({ user, token });
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 401) {
        loginLimiter.recordFailure(ip, userKey);
        const after = loginLimiter.check(ip, userKey);
        if (!after.allowed) {
          // Evento de seguridad: sin el usuario ni la contraseña intentada
          logger.warn('login_locked', { restaurantId, ip, retryAfterSec: after.retryAfterSec, requestId: req.requestId });
          throw tooMany(after.retryAfterSec);
        }
      }
      throw err;
    }
  },

  /** Token nuevo para una sesión válida: la app lo pide sola mientras está abierta. */
  async refresh(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { user, token } = await authService.refresh(req.user.userId, req.user.restaurantId);
    res.json({ user, token });
  },

  async me(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const user = await authService.getMe(req.user.userId, req.user.restaurantId);
    res.json({ user });
  },
};
