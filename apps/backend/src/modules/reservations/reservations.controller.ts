// ──────────────────────────────────────────────
// reservations.controller.ts — Handlers HTTP de reservas
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ReservationStatus } from '@prisma/client';
import { reservationsService } from './reservations.service.js';

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
    const filters = listQuery.parse(req.query);
    const reservations = await reservationsService.list(filters);
    res.json({ reservations });
  },

  async upcoming(_req: Request, res: Response) {
    const reservations = await reservationsService.upcoming(20);
    res.json({ reservations });
  },

  async getById(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const reservation = await reservationsService.getById(id);
    res.json({ reservation });
  },

  async create(req: Request, res: Response) {
    const data = createSchema.parse(req.body);
    const reservation = await reservationsService.create({
      ...data,
      customerPhone: data.customerPhone ?? undefined,
      notes: data.notes ?? undefined,
    });
    res.status(201).json({ reservation });
  },

  async update(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    const reservation = await reservationsService.update(id, {
      ...data,
      customerPhone: data.customerPhone ?? undefined,
      notes: data.notes ?? undefined,
    });
    res.json({ reservation });
  },

  async remove(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    await reservationsService.remove(id);
    res.status(204).send();
  },

  async cancel(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const reservation = await reservationsService.cancel(id);
    res.json({ reservation });
  },

  async noShow(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const reservation = await reservationsService.noShow(id);
    res.json({ reservation });
  },

  async seat(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const result = await reservationsService.seat(id);
    res.json({ reservation: result.reservation, tableId: result.tableId });
  },

  async markTableReserved(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const reservation = await reservationsService.markTableReserved(id);
    res.json({ reservation });
  },
};
