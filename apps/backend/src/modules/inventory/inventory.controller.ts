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
  costPerUnit: z.coerce.number().nonnegative().optional(),
  supplier: z.string().trim().optional().nullable(),
  // Equivalencia entre familias (ej. 1 un = 60 g); null la quita
  equivalenceQty: z.coerce.number().positive().optional().nullable(),
  equivalenceUnit: z.string().trim().max(20).optional().nullable(),
  // Presentación de compra (ej. 25 kg a $25.000): si está, el costo por unidad se calcula
  purchaseQty: z.coerce.number().positive().optional().nullable(),
  purchaseUnit: z.string().trim().max(20).optional().nullable(),
  purchasePrice: z.coerce.number().nonnegative().optional().nullable(),
  // Merma por defecto en recetas (0–0,95)
  wastePct: z.coerce.number().min(0).max(0.95).optional(),
  // Sector (tarea 3.1) y orden en el conteo
  storageAreaId: z.coerce.number().int().positive().optional().nullable(),
  countOrder: z.coerce.number().int().min(0).max(100000).optional(),
});

// La cantidad no se edita: va por /restock, /consume, /adjust o un conteo
const updateSchema = createSchema.omit({ quantity: true }).partial();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const listQuery = z.object({
  category: categoryEnum.optional(),
  search: z.string().trim().optional(),
});
const consumeBody = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().trim().max(500).optional().nullable(),
});
const adjustBody = z.object({
  quantity: z.coerce.number().nonnegative(),
  reason: z.string({ required_error: 'Escribí el motivo del ajuste' }).trim().min(3, 'Escribí el motivo del ajuste').max(500),
});
const movementsQuery = z.object({ limit: z.coerce.number().int().min(1).max(500).optional() });
// Reposición: en la unidad del insumo o en presentaciones, con precio nuevo opcional
const restockBody = z.object({
  amount: z.coerce.number().positive().optional(),
  presentations: z.coerce.number().positive().optional(),
  purchasePrice: z.coerce.number().nonnegative().optional(),
}).refine(d => (d.amount === undefined) !== (d.presentations === undefined), {
  message: 'Indicá la cantidad o la cantidad de presentaciones (una de las dos)',
});

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
    const opts = restockBody.parse(req.body);
    const item = await inventoryService.restock(req.user.restaurantId, id, opts);
    res.json({ item });
  },

  async priceHistory(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    res.json({ history: await inventoryService.priceHistory(req.user.restaurantId, id) });
  },

  async consume(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const { amount, reason } = consumeBody.parse(req.body);
    const item = await inventoryService.consume(req.user.restaurantId, id, amount, reason);
    res.json({ item });
  },

  async adjust(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const { quantity, reason } = adjustBody.parse(req.body);
    const item = await inventoryService.adjust(req.user.restaurantId, id, quantity, reason);
    res.json({ item });
  },

  async movements(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const { limit } = movementsQuery.parse(req.query);
    res.json({ movements: await inventoryService.movements(req.user.restaurantId, id, limit) });
  },
};
