// ──────────────────────────────────────────────
// storage-areas.controller.ts — Sectores de guardado (tarea 3.1)
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../../lib/http-error.js';
import { storageAreasService } from './storage-areas.service.js';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Nombre requerido').max(100),
  sortOrder: z.coerce.number().int().min(0).max(10000).optional(),
});
const updateSchema = createSchema.partial();
const idParam = z.object({ id: z.coerce.number().int().positive() });

export const storageAreasController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    res.json({ areas: await storageAreasService.list(req.user.restaurantId) });
  },
  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    res.status(201).json({ area: await storageAreasService.create(req.user.restaurantId, data) });
  },
  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    res.json({ area: await storageAreasService.update(req.user.restaurantId, id, data) });
  },
  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await storageAreasService.remove(req.user.restaurantId, id);
    res.status(204).send();
  },
};
