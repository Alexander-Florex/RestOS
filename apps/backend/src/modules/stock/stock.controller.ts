// ──────────────────────────────────────────────
// stock.controller.ts — Stock automático, producción, mermas, compras y proveedores (fase 3)
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { stockAutoService } from './stock-auto.service.js';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { rangeParams } from '../../lib/date-query.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const settingsSchema = z.object({ autoStockOnSale: z.boolean() });
const produceSchema = z.object({ recipeId: z.coerce.number().int().positive(), quantity: z.coerce.number().positive() });
const wasteSchema = z.object({ quantity: z.coerce.number().positive(), reason: z.string().trim().min(3, 'Escribí el motivo').max(500) });
const supplierSchema = z.object({
  name: z.string().trim().min(1, 'Poné el nombre').max(120),
  phone: z.string().trim().max(50).optional().nullable(),
  email: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  active: z.boolean().optional(),
});

function dupSupplier(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw HttpError.conflict('Ya hay un proveedor con ese nombre');
  throw err;
}

export const stockController = {
  async settings(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    res.json(await stockAutoService.settings(req.user.restaurantId));
  },
  async setSettings(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    res.json(await stockAutoService.setSettings(req.user.restaurantId, settingsSchema.parse(req.body)));
  },
  async produce(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const d = produceSchema.parse(req.body);
    res.status(201).json(await stockAutoService.produce(req.user.restaurantId, d.recipeId, d.quantity));
  },
  async waste(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const d = wasteSchema.parse(req.body);
    res.status(201).json(await stockAutoService.waste(req.user.restaurantId, id, d.quantity, d.reason));
  },
  async shoppingList(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    res.json({ groups: await stockAutoService.shoppingList(req.user.restaurantId) });
  },
  async unrecipedSales(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { from, to } = rangeParams.parse(req.query);
    res.json({ items: await stockAutoService.unrecipedSales(req.user.restaurantId, from, to) });
  },

  // ── Proveedores ──
  async listSuppliers(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const suppliers = await prisma.supplier.findMany({
      where: { restaurantId: req.user.restaurantId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    });
    res.json({ suppliers: suppliers.map(({ _count, ...s }) => ({ ...s, itemCount: _count.items })) });
  },
  async createSupplier(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const d = supplierSchema.parse(req.body);
    const supplier = await prisma.supplier.create({ data: { ...d, restaurantId: req.user.restaurantId } }).catch(dupSupplier);
    res.status(201).json({ supplier });
  },
  async updateSupplier(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const d = supplierSchema.partial().parse(req.body);
    const found = await prisma.supplier.findFirst({ where: { id, restaurantId: req.user.restaurantId } });
    if (!found) throw HttpError.notFound('Proveedor no encontrado');
    const supplier = await prisma.supplier.update({ where: { id }, data: d }).catch(dupSupplier);
    res.json({ supplier });
  },
  async deleteSupplier(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const found = await prisma.supplier.findFirst({ where: { id, restaurantId: req.user.restaurantId } });
    if (!found) throw HttpError.notFound('Proveedor no encontrado');
    // Los insumos quedan sin proveedor (onDelete SetNull)
    await prisma.supplier.delete({ where: { id } });
    res.status(204).send();
  },
};
