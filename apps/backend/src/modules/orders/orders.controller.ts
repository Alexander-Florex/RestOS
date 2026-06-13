// ──────────────────────────────────────────────
// orders.controller.ts — Handlers HTTP de pedidos
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ordersService } from './orders.service.js';
import { HttpError } from '../../lib/http-error.js';

const orderItemSchema = z.object({
  menuItemId: z.number().int().positive(),
  quantity: z.number().int().positive(),
  notes: z.string().trim().max(500).optional(),
});

const createSchema = z.object({
  tableId: z.number().int().positive(),
  guestCount: z.number().int().positive().optional(),
  notes: z.string().trim().max(500).optional(),
  items: z.array(orderItemSchema).min(1, 'Agregá al menos un item'),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });
const tableIdParam = z.object({ tableId: z.coerce.number().int().positive() });
const listQuery = z.object({ tableId: z.coerce.number().int().positive().optional() });

export const ordersController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { tableId } = listQuery.parse(req.query);
    const orders = await ordersService.list(req.user.restaurantId, { tableId });
    res.json({ orders });
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const order = await ordersService.getById(req.user.restaurantId, id);
    res.json({ order });
  },

  async listByTable(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { tableId } = tableIdParam.parse(req.params);
    const orders = await ordersService.list(req.user.restaurantId, { tableId });
    const total = await ordersService.getTableTotal(req.user.restaurantId, tableId);
    res.json({ orders, total });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    const order = await ordersService.create(req.user.restaurantId, {
      ...data,
      createdById: req.user.userId,
    });
    res.status(201).json({ order });
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await ordersService.remove(req.user.restaurantId, id);
    res.status(204).send();
  },
};