// ──────────────────────────────────────────────
// request-id.ts — Código único por pedido HTTP
//
// Viaja en el header X-Request-Id de la respuesta, en el log de acceso y en
// el log de errores. Un error 500 se lo muestra al usuario para que, si lo
// reporta, se encuentre el detalle en logs/app-*.log.
// ──────────────────────────────────────────────
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// Solo se acepta uno entrante con forma segura (lo puede mandar un proxy); si no, se genera
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/** Primeros 8 caracteres: alcanza para buscarlo en el log y es fácil de dictar. */
export function shortId(id: string | undefined): string {
  return (id ?? '').slice(0, 8);
}
