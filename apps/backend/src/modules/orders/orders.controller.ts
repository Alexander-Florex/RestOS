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
  optionIds: z.array(z.number().int().positive()).max(50).optional(),
});

const createSchema = z.object({
  tableId: z.number().int().positive(),
  guestCount: z.number().int().positive().optional(),
  notes: z.string().trim().max(500).optional(),
  items: z.array(orderItemSchema).min(1, 'Agregá al menos un item'),
  clientRequestId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });
const tableIdParam = z.object({ tableId: z.coerce.number().int().positive() });
const listQuery = z.object({
  tableId: z.coerce.number().int().positive().optional(),
  // Por defecto solo los abiertos; ALL incluye cobrados y anulados (historial)
  status: z.enum(['OPEN', 'PAID', 'CANCELLED', 'ALL']).optional(),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'Indicá el motivo de la anulación').max(500),
});

export const ordersController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { tableId, status } = listQuery.parse(req.query);
    const orders = await ordersService.list(req.user.restaurantId, { tableId, status });
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

  /** Anula un pedido abierto (no se borra: queda en el historial con el motivo). */
  async cancel(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const { reason } = cancelSchema.parse(req.body);
    const order = await ordersService.cancel(req.user.restaurantId, id, { reason, cancelledById: req.user.userId });
    res.json({ order });
  },
};