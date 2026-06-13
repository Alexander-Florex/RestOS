// ──────────────────────────────────────────────
// menu.controller.ts — Handlers HTTP del menú
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { StockStatus } from '@prisma/client';
import { menuService } from './menu.service.js';
import { HttpError } from '../../lib/http-error.js';

const stockEnum = z.nativeEnum(StockStatus);

const createSchema = z.object({
  name: z.string().min(1, 'Nombre requerido').trim(),
  category: z.string().min(1, 'Categoría requerida').trim(),
  price: z.coerce.number().nonnegative('El precio no puede ser negativo'),
  description: z.string().trim().optional().nullable(),
  stock: stockEnum.optional(),
  enabled: z.boolean().optional(),
  imageUrl: z.string().url().optional().nullable(),
});

const updateSchema = createSchema.partial();

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  category: z.string().trim().optional(),
  onlyEnabled: z.coerce.boolean().optional(),
});

const stockBody = z.object({ stock: stockEnum });

export const menuController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const opts = listQuery.parse(req.query);
    const items = await menuService.list(req.user.restaurantId, opts);
    res.json({ items });
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const item = await menuService.getById(req.user.restaurantId, id);
    res.json({ item });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    const item = await menuService.create(req.user.restaurantId, {
      ...data,
      description: data.description ?? undefined,
      imageUrl: data.imageUrl ?? undefined,
    });
    res.status(201).json({ item });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    const item = await menuService.update(req.user.restaurantId, id, {
      ...data,
      description: data.description ?? undefined,
      imageUrl: data.imageUrl ?? undefined,
    });
    res.json({ item });
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await menuService.remove(req.user.restaurantId, id);
    res.status(204).send();
  },

  async toggleEnabled(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const item = await menuService.toggleEnabled(req.user.restaurantId, id);
    res.json({ item });
  },

  async setStock(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const { stock } = stockBody.parse(req.body);
    const item = await menuService.setStock(req.user.restaurantId, id, stock);
    res.json({ item });
  },
};
