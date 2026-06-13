// ──────────────────────────────────────────────
// reservations.controller.ts — Handlers HTTP de reservas
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ReservationStatus } from '@prisma/client';
import { reservationsService } from './reservations.service.js';
import { HttpError } from '../../lib/http-error.js';

const statusEnum = z.nativeEnum(ReservationStatus);

const createSchema = z.object({
  customerName: z.string().min(1, 'Nombre requerido').trim(),
  customerPhone: z.string().trim().optional().nullable(),
  partySize: z.coerce.number().int().positive(),
  reservedAt: z.coerce.date(),
  duration: z.coerce.number().int().min(15).optional(),
  tableId: z.coerce.number().int().positive().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  status: statusEnum.optional(),
});

const updateSchema = createSchema.partial();
const idParam = z.object({ id: z.coerce.number().int().positive() });

const listQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: statusEnum.optional(),
  tableId: z.coerce.number().int().positive().optional(),
});

export const reservationsController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const filters = listQuery.parse(req.query);
    const reservations = await reservationsService.list(req.user.restaurantId, filters);
    res.json({ reservations });
  },

  async upcoming(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const reservations = await reservationsService.upcoming(req.user.restaurantId, 20);
    res.json({ reservations });
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const reservation = await reservationsService.getById(req.user.restaurantId, id);
    res.json({ reservation });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    const reservation = await reservationsService.create(req.user.restaurantId, {
      ...data,
      customerPhone: data.customerPhone ?? undefined,
      notes: data.notes ?? undefined,
    });
    res.status(201).json({ reservation });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    const reservation = await reservationsService.update(req.user.restaurantId, id, {
      ...data,
      customerPhone: data.customerPhone ?? undefined,
      notes: data.notes ?? undefined,
    });
    res.json({ reservation });
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await reservationsService.remove(req.user.restaurantId, id);
    res.status(204).send();
  },

  async cancel(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const reservation = await reservationsService.cancel(req.user.restaurantId, id);
    res.json({ reservation });
  },

  async noShow(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const reservation = await reservationsService.noShow(req.user.restaurantId, id);
    res.json({ reservation });
  },

  async seat(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const result = await reservationsService.seat(req.user.restaurantId, id);
    res.json({ reservation: result.reservation, tableId: result.tableId });
  },

  async markTableReserved(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const reservation = await reservationsService.markTableReserved(req.user.restaurantId, id);
    res.json({ reservation });
  },
};
