// ──────────────────────────────────────────────
// accounts.controller.ts — Cuenta corriente (permiso accounts.manage)
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PaymentMethod } from '@prisma/client';
import { accountsService } from './accounts.service.js';
import { HttpError } from '../../lib/http-error.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const customerSchema = z.object({
  name: z.string().trim().min(1, 'Poné el nombre del cliente').max(120),
  cuit: z.string().trim().max(20).optional().nullable(),
  contact: z.string().trim().max(200).optional().nullable(),
});
const customerUpdateSchema = customerSchema.partial().extend({ active: z.boolean().optional() });
const paymentSchema = z.object({
  saleIds: z.array(z.coerce.number().int().positive()).min(1, 'Elegí qué comidas paga').max(500),
  surchargePct: z.coerce.number().min(0, 'El recargo no puede ser negativo').max(300),
  paymentMethod: z.nativeEnum(PaymentMethod),
  notes: z.string().trim().max(500).optional().nullable(),
});
const cancelSchema = z.object({ reason: z.string().trim().min(3, 'Escribí el motivo').max(300) });

export const accountsController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    res.json({ customers: await accountsService.listCustomers(req.user.restaurantId) });
  },
  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const customer = await accountsService.createCustomer(req.user.restaurantId, customerSchema.parse(req.body));
    res.status(201).json({ customer });
  },
  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const customer = await accountsService.updateCustomer(req.user.restaurantId, id, customerUpdateSchema.parse(req.body));
    res.json({ customer });
  },
  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await accountsService.removeCustomer(req.user.restaurantId, id);
    res.status(204).send();
  },
  async statement(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    res.json(await accountsService.statement(req.user.restaurantId, id));
  },
  async registerPayment(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const d = paymentSchema.parse(req.body);
    const payment = await accountsService.registerPayment(req.user.restaurantId, { ...d, customerId: id, userId: req.user.userId });
    res.status(201).json({ payment });
  },
  async cancelPayment(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const { reason } = cancelSchema.parse(req.body ?? {});
    await accountsService.cancelPayment(req.user.restaurantId, id, reason);
    res.status(204).send();
  },
};
