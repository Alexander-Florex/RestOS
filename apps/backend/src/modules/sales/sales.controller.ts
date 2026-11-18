// ──────────────────────────────────────────────
// sales.controller.ts — Handlers HTTP de ventas
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';
import { salesService } from './sales.service.js';
import { HttpError } from '../../lib/http-error.js';
import { dayParam } from '../../lib/date-query.js';
import { rolesService } from '../roles/roles.service.js';

const paymentEnum = z.nativeEnum(PaymentMethod);

const createSchema = z.object({
  tableId: z.number().int().positive(),
  // Mesas unidas: cobrar todas juntas en una venta
  wholeGroup: z.boolean().optional(),
  // Un solo medio (paymentMethod + amount) o varios (payments) — tarea 5.2
  paymentMethod: paymentEnum.optional(),
  // A cuenta (tarea 5.9): de qué cliente de cuenta corriente
  customerId: z.number().int().positive().optional(),
  amount: z.coerce.number().nonnegative().optional(),
  payments: z.array(z.object({
    method: paymentEnum,
    amount: z.coerce.number().nonnegative(),
  })).min(1).max(20).optional(),
  // Descuento con motivo (permiso sales.discount)
  discountPct: z.coerce.number().min(0).max(100).optional().nullable(),
  discountAmount: z.coerce.number().min(0).optional().nullable(),
  discountReason: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(1000).optional(),
  imageBase64: z.string().max(15_000_000).optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  paymentMethod: paymentEnum.optional(),
});

const statsQuery = z.object({
  date: dayParam.optional(),
});

export const salesController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const filters = listQuery.parse(req.query);
    const sales = await salesService.list(req.user.restaurantId, filters);
    res.json({ sales });
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const sale = await salesService.getById(req.user.restaurantId, id);
    res.json({ sale });
  },

  /** Imagen del comprobante (transferencia, etc.). Privada: requiere login y venta propia. */
  async receipt(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const file = await salesService.receiptFile(req.user.restaurantId, id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(file);
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    if (!data.paymentMethod && !data.payments) throw HttpError.badRequest('Indicá cómo se paga');
    const wantsDiscount = (data.discountPct ?? 0) > 0 || (data.discountAmount ?? 0) > 0;
    if (data.paymentMethod === PaymentMethod.ACCOUNT || wantsDiscount) {
      const access = await rolesService.getAccess(req.user.userId, req.user.restaurantId);
      // Dejar a cuenta: solo quien tiene "Cuentas corrientes" (Caja y Administrador por defecto)
      if (data.paymentMethod === PaymentMethod.ACCOUNT && !access.permissions.includes('accounts.manage')) {
        throw HttpError.forbidden('Tu rol no puede dejar mesas a cuenta');
      }
      if (wantsDiscount && !access.permissions.includes('sales.discount')) {
        throw HttpError.forbidden('Tu rol no puede hacer descuentos');
      }
    }
    const sale = await salesService.create(req.user.restaurantId, {
      ...data,
      registeredById: req.user.userId,
    });
    res.status(201).json({ sale });
  },

  async dailyStats(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { date } = statsQuery.parse(req.query);
    const stats = await salesService.dailyStats(req.user.restaurantId, date);
    res.json(stats);
  },
};
