// ──────────────────────────────────────────────
// sales.controller.ts — Handlers HTTP de ventas
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';
import { salesService } from './sales.service.js';
import { HttpError } from '../../lib/http-error.js';

const paymentEnum = z.nativeEnum(PaymentMethod);

const createSchema = z.object({
  tableId: z.number().int().positive(),
  paymentMethod: paymentEnum,
  amount: z.coerce.number().nonnegative(),
  notes: z.string().trim().max(1000).optional(),
  imageBase64: z.string().max(15_000_000).optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  paymentMethod: paymentEnum.optional(),
});

const statsQuery = z.object({
  date: z.coerce.date().optional(),
});

export const salesController = {
  async list(req: Request, res: Response) {
    const filters = listQuery.parse(req.query);
    const sales = await salesService.list(filters);
    res.json({ sales });
  },

  async getById(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const sale = await salesService.getById(id);
    res.json({ sale });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    const sale = await salesService.create({
      ...data,
      registeredById: req.user.userId,
    });
    res.status(201).json({ sale });
  },

  async dailyStats(req: Request, res: Response) {
    const { date } = statsQuery.parse(req.query);
    const stats = await salesService.dailyStats(date);
    res.json(stats);
  },
};
