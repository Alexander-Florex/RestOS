// ──────────────────────────────────────────────
// stock-counts.controller.ts — Toma de inventario (tarea 3.3)
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../../lib/http-error.js';
import { stockCountsService } from './stock-counts.service.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const lineParams = z.object({
  id: z.coerce.number().int().positive(),
  lineId: z.coerce.number().int().positive(),
});
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() });
const createBody = z.object({
  // null = todo el stock
  storageAreaId: z.coerce.number().int().positive().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
const lineBody = z.object({
  countedQty: z.coerce.number().nonnegative().max(10_000_000).nullable().optional(),
  reason: z.string().trim().max(300).nullable().optional(),
}).refine(d => d.countedQty !== undefined || d.reason !== undefined, { message: 'Nada para guardar' });
const closeBody = z.object({ notes: z.string().trim().max(1000).optional().nullable() });
const cancelBody = z.object({ reason: z.string().trim().max(500).optional().nullable() });

export const stockCountsController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { limit } = listQuery.parse(req.query);
    res.json({ counts: await stockCountsService.list(req.user.restaurantId, limit) });
  },
  async get(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    res.json({ count: await stockCountsService.get(req.user.restaurantId, id) });
  },
  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createBody.parse(req.body);
    res.status(201).json({ count: await stockCountsService.create(req.user.restaurantId, data) });
  },
  async setLine(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id, lineId } = lineParams.parse(req.params);
    const data = lineBody.parse(req.body);
    res.json({ line: await stockCountsService.setLine(req.user.restaurantId, id, lineId, data) });
  },
  async summary(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    res.json({ summary: await stockCountsService.summary(req.user.restaurantId, id) });
  },
  async close(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const data = closeBody.parse(req.body ?? {});
    res.json(await stockCountsService.close(req.user.restaurantId, id, data));
  },
  async cancel(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const { reason } = cancelBody.parse(req.body ?? {});
    res.json({ count: await stockCountsService.cancel(req.user.restaurantId, id, reason) });
  },
};
