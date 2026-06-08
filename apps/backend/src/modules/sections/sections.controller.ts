// ──────────────────────────────────────────────
// sections.controller.ts
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { sectionsService } from './sections.service.js';

const createSchema = z.object({
  name:  z.string().min(1, 'Nombre requerido').trim(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (debe ser #rrggbb)').optional(),
  order: z.coerce.number().int().nonnegative().optional(),
});
const updateSchema = createSchema.partial();
const idParam = z.object({ id: z.coerce.number().int().positive() });

export const sectionsController = {
  async list(_req: Request, res: Response) {
    const sections = await sectionsService.list();
    res.json({ sections });
  },
  async create(req: Request, res: Response) {
    const data = createSchema.parse(req.body);
    const section = await sectionsService.create(data);
    res.status(201).json({ section });
  },
  async update(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    const section = await sectionsService.update(id, data);
    res.json({ section });
  },
  async remove(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    await sectionsService.remove(id);
    res.status(204).send();
  },
};
