// ──────────────────────────────────────────────
// recipes.controller.ts — Handlers HTTP de recetas y costos
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { recipesService } from './recipes.service.js';
import { HttpError } from '../../lib/http-error.js';

// Un insumo o una sub-receta (tarea 2.3), con merma opcional de la línea (2.4)
const ingredientSchema = z.object({
  inventoryItemId: z.number().int().positive().optional().nullable(),
  subRecipeId: z.number().int().positive().optional().nullable(),
  quantity: z.coerce.number().positive(),
  unit: z.string().min(1, 'Unidad requerida').trim(),
  wastePct: z.coerce.number().min(0).max(0.95).optional().nullable(),
}).refine(i => !!i.inventoryItemId !== !!i.subRecipeId, { message: 'Cada ingrediente es un insumo o una sub-receta' });

const createSchema = z.object({
  name: z.string().min(1, 'Nombre requerido').trim(),
  menuItemId: z.number().int().positive().optional().nullable(),
  yield: z.coerce.number().int().positive().optional(),
  // Rendimiento en unidades (ej. 500 cc), para usarla como sub-receta
  yieldQty: z.coerce.number().positive().optional().nullable(),
  yieldUnit: z.string().trim().max(20).optional().nullable(),
  // Margen objetivo SOBRE EL PRECIO (fórmula del cliente): 0–0,95
  profitPct: z.coerce.number().min(0).max(0.95, 'El margen tiene que ser menor a 95 % (es sobre el precio)').optional(),
  vatPct: z.coerce.number().min(0).optional(),
  notes: z.string().trim().optional().nullable(),
  ingredients: z.array(ingredientSchema).min(1, 'Agregá al menos un ingrediente'),
});

const updateSchema = createSchema.partial().extend({
  ingredients: z.array(ingredientSchema).min(1).optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

const alertsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export const recipesController = {
  /** Insumos que subieron y platos afectados (tarea 2.8) */
  async costAlerts(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { days } = alertsQuery.parse(req.query);
    res.json({ alerts: await recipesService.costAlerts(req.user.restaurantId, days) });
  },

  /** Costo y margen de cada plato de la carta (tarea 2.7) */
  async menuCosts(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    res.json({ items: await recipesService.menuCosts(req.user.restaurantId) });
  },

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
