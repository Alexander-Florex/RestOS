// ──────────────────────────────────────────────
// error.ts — Middleware global de errores
// ──────────────────────────────────────────────
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/http-error.js';
import { env } from '../config/env.js';

// 404 — ruta no encontrada (montar al final de las rutas)
export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: 'Endpoint no encontrado' });
}

// Error handler (4 parámetros — Express lo detecta como error middleware)
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  // ── Errores HTTP propios ──
  if (err instanceof HttpError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
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
  }

  // ── Fallback ──
  console.error('💥 Error no manejado:', err);
  res.status(500).json({
    error: 'Error interno del servidor',
    ...(env.NODE_ENV === 'development' && err instanceof Error
      ? { message: err.message, stack: err.stack }
      : {}),
  });
}
