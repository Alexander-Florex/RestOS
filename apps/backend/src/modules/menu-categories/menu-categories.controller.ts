// ──────────────────────────────────────────────
// menu-categories.controller.ts — Handlers HTTP de categorías del menú
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { menuCategoriesService } from './menu-categories.service.js';
import { HttpError } from '../../lib/http-error.js';

const createSchema = z.object({
  name: z.string().min(1, 'Nombre requerido').trim(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (formato #rrggbb)').optional(),
  order: z.coerce.number().int().optional(),
});

const updateSchema = createSchema.partial();

const idParam = z.object({ id: z.coerce.number().int().positive() });

export const menuCategoriesController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const categories = await menuCategoriesService.list(req.user.restaurantId);
    res.json({ categories });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    const category = await menuCategoriesService.create(req.user.restaurantId, data);
    res.status(201).json({ category });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    const category = await menuCategoriesService.update(req.user.restaurantId, id, data);
    res.json({ category });
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await menuCategoriesService.remove(req.user.restaurantId, id);
    res.status(204).send();
  },
};
