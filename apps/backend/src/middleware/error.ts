// ──────────────────────────────────────────────
// error.ts — Middleware global de errores
// ──────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/http-error.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { shortId } from './request-id.js';

// 404 — ruta no encontrada (montar al final de las rutas)
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Endpoint no encontrado' });
}

// Error handler (4 parámetros — Express lo detecta como error middleware)
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // ── Errores HTTP propios ──
  if (err instanceof HttpError) {
    const retryAfter = (err.details as { retryAfterSec?: number } | undefined)?.retryAfterSec;
    if (err.statusCode === 429 && retryAfter) res.setHeader('Retry-After', String(retryAfter));
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // ── Errores del parser de body (express.json) ──
  const bodyErr = err as { type?: string; status?: number } | null;
  if (bodyErr?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Los datos enviados son demasiado grandes' });
  }
  if (bodyErr?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo del pedido no es un JSON válido' });
  }
  if (bodyErr?.type && bodyErr.status && bodyErr.status >= 400 && bodyErr.status < 500) {
    return res.status(bodyErr.status).json({ error: 'Solicitud inválida' });
  }

  // ── Errores de validación Zod ──
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Datos inválidos',
      details: err.flatten().fieldErrors,
    });
  }

  // ── Errores de Prisma ──
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'campo';
      return res.status(409).json({ error: `Ya existe un registro con ese ${target}` });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }
    if (err.code === 'P2003') {
      // Foreign key constraint failed — típicamente un token JWT desactualizado
      // (userId/restaurantId que ya no existen porque se reseedeó la base).
      return res.status(409).json({
        error: 'Referencia inválida (registro relacionado no existe). Cerrá sesión y volvé a iniciar sesión.',
        field: err.meta?.field_name ?? undefined,
      });
    }
  }

  // Datos con forma inválida que llegaron hasta Prisma (por ejemplo un id "abc"
  // que quedó como NaN, o un enum desconocido en la query): es un error del pedido, no del servidor.
  if (err instanceof Prisma.PrismaClientValidationError) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  // ── Fallback ──
  // El detalle queda en el log (con el código del pedido); al cliente solo se le
  // da el código para reportarlo, y el mensaje técnico únicamente en desarrollo.
  logger.error('unhandled_error', {
    requestId: req.requestId,
    method: req.method,
    path: req.path, // sin query string
    userId: req.user?.userId,
    restaurantId: req.user?.restaurantId,
    error: err,
  });
  const isDev = env.NODE_ENV === 'development';
  const code = shortId(req.requestId);
  res.status(500).json({
    error: code
      ? `Error interno del servidor (código ${code}). Si se repite, avisá a quien administra el sistema.`
      : 'Error interno del servidor',
    requestId: req.requestId,
    ...(isDev && err instanceof Error ? { message: err.message, stack: err.stack } : {}),
  });
}