// ──────────────────────────────────────────────
// order-changes.controller.ts — Cambiar o rehacer platos (tarea 5.8)
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ItemChangeFault, ItemChangeStatus } from '@prisma/client';
import { HttpError } from '../../lib/http-error.js';
import { rangeParams } from '../../lib/date-query.js';
import { rolesService } from '../roles/roles.service.js';
import { orderChangesService } from './order-changes.service.js';

const itemParam = z.object({ itemId: z.coerce.number().int().positive() });
const idParam = z.object({ id: z.coerce.number().int().positive() });

const base = {
  quantity: z.number().int().positive().default(1),
  reason: z.string().trim().min(3, 'Escribí el motivo del cambio').max(500),
  fault: z.nativeEnum(ItemChangeFault).optional().nullable(),
};

const remakeSchema = z.object(base);

const replaceSchema = z.object({
  ...base,
  wasPrepared: z.boolean().default(false),
  replacement: z.object({
    menuItemId: z.number().int().positive(),
    optionIds: z.array(z.number().int().positive()).max(50).optional(),
    notes: z.string().trim().max(500).optional().nullable(),
  }),
});

const rejectSchema = z.object({ reason: z.string().trim().max(500).optional().nullable() });

const listQuery = z.object({
  status: z.nativeEnum(ItemChangeStatus).optional(),
  tableId: z.coerce.number().int().positive().optional(),
});

export const orderChangesController = {
  async remake(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { itemId } = itemParam.parse(req.params);
    const data = remakeSchema.parse(req.body);
    const change = await orderChangesService.remake(req.user.restaurantId, itemId, { ...data, userId: req.user.userId });
    res.status(201).json({ change });
  },

  /** Con permiso de autorizar se aplica en el acto; si no, queda pendiente para caja. */
  async replace(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { itemId } = itemParam.parse(req.params);
    const data = replaceSchema.parse(req.body);
    const access = await rolesService.getAccess(req.user.userId, req.user.restaurantId);
    const canApprove = access.permissions.includes('orders.change.approve');
    const change = await orderChangesService.replace(req.user.restaurantId, itemId, { ...data, userId: req.user.userId }, canApprove);
    res.status(201).json({ change });
  },

  async approve(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    res.json({ change: await orderChangesService.approve(req.user.restaurantId, id, req.user.userId) });
  },

  async reject(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const { reason } = rejectSchema.parse(req.body ?? {});
    res.json({ change: await orderChangesService.reject(req.user.restaurantId, id, req.user.userId, reason) });
  },

  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const q = listQuery.parse(req.query);
    const range = req.query.from || req.query.to ? rangeParams.parse(req.query) : {};
    res.json({ changes: await orderChangesService.list(req.user.restaurantId, { ...q, ...range }) });
  },
};
