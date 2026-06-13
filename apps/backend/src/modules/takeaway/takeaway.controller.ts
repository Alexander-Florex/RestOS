// ──────────────────────────────────────────────
// takeaway.controller.ts — multi-tenant
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { TakeawayStatus, PaymentMethod } from '@prisma/client';
import { takeawayService } from './takeaway.service.js';
import { HttpError } from '../../lib/http-error.js';

const createSchema = z.object({
  customerName: z.string().min(1),
  customerPhone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(z.object({
    menuItemId: z.number().int().positive(),
    quantity: z.number().int().positive(),
    notes: z.string().optional().nullable(),
  })).min(1),
});

const paySchema = z.object({
  paymentMethod: z.nativeEnum(PaymentMethod),
  amountPaid: z.number().positive(),
});

export const takeawayController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const restaurantId = req.user.restaurantId;
    const status = req.query.status as TakeawayStatus | undefined;
    const orders = await takeawayService.list(restaurantId, status);
    res.json({ orders });
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const order = await takeawayService.getById(req.user.restaurantId, Number(req.params.id));
    res.json({ order });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    const order = await takeawayService.create(req.user.restaurantId, {
      ...data,
      createdById: req.user.userId,
    });
    res.status(201).json({ order });
  },

  async markReady(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const order = await takeawayService.markReady(req.user.restaurantId, Number(req.params.id));
    res.json({ order });
  },

  async pay(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { paymentMethod, amountPaid } = paySchema.parse(req.body);
    const order = await takeawayService.pay(req.user.restaurantId, Number(req.params.id), paymentMethod, amountPaid);
    res.json({ order });
  },

  async cancel(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const order = await takeawayService.cancel(req.user.restaurantId, Number(req.params.id));
    res.json({ order });
  },
}

  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    await takeawayService.remove(req.user.restaurantId, Number(req.params.id));
    res.status(204).send();
  },
};