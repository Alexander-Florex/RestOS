// ──────────────────────────────────────────────
// sections.controller.ts
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { HttpError } from '../../lib/http-error.js';
import { sectionsService } from './sections.service.js';

const createSchema = z.object({
  name:  z.string().min(1, 'Nombre requerido').trim(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (debe ser #rrggbb)').optional(),
  order: z.coerce.number().int().nonnegative().optional(),
});
const updateSchema = createSchema.partial();
const idParam = z.object({ id: z.coerce.number().int().positive() });

export const sectionsController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const sections = await sectionsService.list(req.user.restaurantId);
    res.json({ sections });
  },
  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    const section = await sectionsService.create(req.user.restaurantId, data);
    res.status(201).json({ section });
  },
  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    const section = await sectionsService.update(req.user.restaurantId, id, data);
    res.json({ section });
  },
  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await sectionsService.remove(req.user.restaurantId, id);
    res.status(204).send();
  },
};
