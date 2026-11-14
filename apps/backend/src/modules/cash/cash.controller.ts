// ──────────────────────────────────────────────
// cash.controller.ts — Caja (permiso cash.manage)
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CashMovementType } from '@prisma/client';
import { cashService } from './cash.service.js';
import { HttpError } from '../../lib/http-error.js';

const openSchema = z.object({ openingAmount: z.coerce.number().min(0, 'El monto inicial no puede ser negativo') });
const movementSchema = z.object({
  type: z.nativeEnum(CashMovementType),
  amount: z.coerce.number().positive('El monto tiene que ser mayor a cero'),
  reason: z.string().trim().min(3, 'Escribí el motivo').max(200),
});
const closeSchema = z.object({
  countedCash: z.coerce.number().min(0, 'El efectivo contado no puede ser negativo'),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const cashController = {
  async current(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    res.json(await cashService.current(req.user.restaurantId));
  },
  async open(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { openingAmount } = openSchema.parse(req.body);
    res.status(201).json({ session: await cashService.open(req.user.restaurantId, openingAmount, req.user.userId) });
  },
  async movement(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const d = movementSchema.parse(req.body);
    res.status(201).json({ movement: await cashService.addMovement(req.user.restaurantId, { ...d, userId: req.user.userId }) });
  },
  async close(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const d = closeSchema.parse(req.body);
    res.json({ session: await cashService.close(req.user.restaurantId, { ...d, userId: req.user.userId }) });
  },
  async history(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    res.json({ sessions: await cashService.history(req.user.restaurantId) });
  },
};
