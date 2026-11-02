// ──────────────────────────────────────────────
// auth.ts — Middleware de autenticación y roles
// ──────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import { HttpError } from '../lib/http-error.js';
import type { Permission } from '../lib/permissions.js';
import { rolesService } from '../modules/roles/roles.service.js';
import { runWithContext } from '../lib/request-context.js';

// Extiende el Request de Express con el user autenticado
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Valida el token y que el usuario siga existiendo y activo (caché corta):
 * desactivar o borrar un usuario corta su sesión aunque el token no haya vencido.
 */
function acceptToken(token: string, req: Request, next: NextFunction) {
  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(HttpError.unauthorized('Token inválido o expirado'));
  }
  rolesService.getAccess(payload.userId, payload.restaurantId)
    .then((access) => {
      if (!access.active) return next(HttpError.unauthorized('Sesión inválida'));
      req.user = payload;
      // El resto del pedido corre sabiendo quién es (lo usa la auditoría)
      runWithContext({ userId: payload.userId, restaurantId: payload.restaurantId, requestId: req.requestId }, next);
    })
    .catch(next);
}

/**
 * Verifica que el request traiga un Bearer token válido de un usuario activo.
 * Adjunta el payload decoded a req.user.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(HttpError.unauthorized('Falta token de autorización'));
  }
  acceptToken(header.slice(7).trim(), req, next);
}

/**
 * Restringe el endpoint a usuarios cuyo rol tenga AL MENOS UNO de los permisos indicados.
 * Lee el rol desde la base (caché corta), así los cambios de permisos y las bajas
 * de usuarios se aplican sin esperar a que venza el token.
 * Usar siempre después de authenticate.
 *
 * Ejemplo: router.post('/', authenticate, requirePermission('sales.charge'), handler);
 */
export function requirePermission(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(HttpError.unauthorized());
    rolesService.getAccess(req.user.userId, req.user.restaurantId)
      .then((access) => {
        if (!access.active) return next(HttpError.unauthorized('Sesión inválida'));
        if (!perms.some(p => access.permissions.includes(p))) {
          return next(HttpError.forbidden('No tenés permiso para esta acción'));
        }
        next();
      })
      .catch(next);
  };
}
