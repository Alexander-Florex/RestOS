// ──────────────────────────────────────────────
// recipes.controller.ts — Handlers HTTP de recetas y costos
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { recipesService } from './recipes.service.js';
import { HttpError } from '../../lib/http-error.js';

const ingredientSchema = z.object({
  inventoryItemId: z.number().int().positive(),
  quantity: z.coerce.number().positive(),
  unit: z.string().min(1, 'Unidad requerida').trim(),
});

const createSchema = z.object({
  name: z.string().min(1, 'Nombre requerido').trim(),
  menuItemId: z.number().int().positive().optional().nullable(),
  yield: z.coerce.number().int().positive().optional(),
  profitPct: z.coerce.number().min(0).optional(),
  vatPct: z.coerce.number().min(0).optional(),
  notes: z.string().trim().optional().nullable(),
  ingredients: z.array(ingredientSchema).min(1, 'Agregá al menos un ingrediente'),
});

const updateSchema = createSchema.partial().extend({
  ingredients: z.array(ingredientSchema).min(1).optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

export const recipesController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const recipes = await recipesService.list(req.user.restaurantId);
    res.json({ recipes });
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const recipe = await recipesService.getById(req.user.restaurantId, id);
    res.json({ recipe });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    const recipe = await recipesService.create(req.user.restaurantId, {
      ...data,
      menuItemId: data.menuItemId ?? undefined,
      notes: data.notes ?? undefined,
    });
    res.status(201).json({ recipe });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    const recipe = await recipesService.update(req.user.restaurantId, id, {
      ...data,
      menuItemId: data.menuItemId ?? undefined,
      notes: data.notes ?? undefined,
    });
    res.json({ recipe });
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await recipesService.remove(req.user.restaurantId, id);
    res.status(204).send();
  },
};
