// ──────────────────────────────────────────────
// inventory.controller.ts — Handlers HTTP de inventario
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { InventoryCategory } from '@prisma/client';
import { inventoryService } from './inventory.service.js';
import { HttpError } from '../../lib/http-error.js';

const categoryEnum = z.nativeEnum(InventoryCategory);

const createSchema = z.object({
  name: z.string().min(1, 'Nombre requerido').trim(),
  category: categoryEnum,
  quantity: z.coerce.number().nonnegative(),
  unit: z.string().min(1, 'Unidad requerida').trim(),
  minStock: z.coerce.number().nonnegative().optional(),
  supplier: z.string().trim().optional().nullable(),
});

const updateSchema = createSchema.partial();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const listQuery = z.object({
  category: categoryEnum.optional(),
  search: z.string().trim().optional(),
});
const amountBody = z.object({ amount: z.coerce.number().positive() });

export const inventoryController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const opts = listQuery.parse(req.query);
    const items = await inventoryService.list(req.user.restaurantId, opts);
    res.json({ items });
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const item = await inventoryService.getById(req.user.restaurantId, id);
    res.json({ item });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    const item = await inventoryService.create(req.user.restaurantId, {
      ...data,
      supplier: data.supplier ?? undefined,
    });
    res.status(201).json({ item });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    const item = await inventoryService.update(req.user.restaurantId, id, {
      ...data,
      supplier: data.supplier ?? undefined,
    });
    res.json({ item });
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await inventoryService.remove(req.user.restaurantId, id);
    res.status(204).send();
  },

  async restock(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const { amount } = amountBody.parse(req.body);
    const item = await inventoryService.restock(req.user.restaurantId, id, amount);
    res.json({ item });
  },

  async consume(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const { amount } = amountBody.parse(req.body);
    const item = await inventoryService.consume(req.user.restaurantId, id, amount);
    res.json({ item });
  },
};
