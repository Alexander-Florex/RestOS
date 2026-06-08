// ──────────────────────────────────────────────
// auth.ts — Middleware de autenticación y roles
// ──────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import { HttpError } from '../lib/http-error.js';

// Extiende el Request de Express con el user autenticado
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Verifica que el request traiga un Bearer token válido.
 * Adjunta el payload decoded a req.user.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(HttpError.unauthorized('Falta token de autorización'));
  }

  const token = header.slice(7).trim();
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(HttpError.unauthorized('Token inválido o expirado'));
  }
}

/**
 * Restringe el endpoint a los roles indicados.
 * Usar siempre después de authenticate.
 *
 * Ejemplo: router.delete('/foo', authenticate, requireRole('ADMIN'), handler);
 */
export function requireRole(...roles: Array<JwtPayload['role']>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(HttpError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(HttpError.forbidden('No tenés permiso para esta acción'));
    }
    next();
  };
}

/**
 * Variante de authenticate que acepta el token vía query string (?token=...).
 * Útil para descargas de archivos donde no se puede setear el header Authorization
 * (por ejemplo, `<a href="/api/reports/sales.csv?token=...">`).
 *
 * Si no encuentra el token por query, intenta también el header Authorization estándar.
 */
export function authenticateFromQuery(req: Request, _res: Response, next: NextFunction) {
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7).trim()
    : null;
  const token = queryToken || headerToken;

  if (!token) return next(HttpError.unauthorized('Falta token de autorización'));

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    next(HttpError.unauthorized('Token inválido o expirado'));
  }
}
