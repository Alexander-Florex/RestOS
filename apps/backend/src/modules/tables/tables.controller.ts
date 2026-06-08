// ──────────────────────────────────────────────
// tables.controller.ts — Handlers HTTP de mesas
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { tablesService } from './tables.service.js';

const createSchema = z.object({
  number:    z.coerce.number().int().positive('El número debe ser positivo'),
  capacity:  z.coerce.number().int().min(1, 'Mínimo 1 comensal').max(500).optional(),
  sectionId: z.coerce.number().int().positive().optional().nullable(),
});

const updateSchema = z.object({
  number:    z.coerce.number().int().positive().optional(),
  capacity:  z.coerce.number().int().min(1).max(500).optional(),
  sectionId: z.coerce.number().int().positive().optional().nullable(),
  enabled:   z.boolean().optional(),
}).refine(
  (data) => Object.keys(data).some(k => data[k as keyof typeof data] !== undefined),
  { message: 'Especificá al menos un campo a actualizar' }
);

const openSchema = z.object({
  // Mínimo 1 — sin límite superior artificial aquí; el service valida contra capacity
  guestCount: z.coerce.number().int().min(1, 'Mínimo 1 comensal'),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const tablesController = {
  async list(_req: Request, res: Response) {
    const tables = await tablesService.list();
    res.json({ tables });
  },

  async getById(req: Request, res: Response) {
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.getById(id);
    res.json({ table });
  },

  async create(req: Request, res: Response) {
    const data = createSchema.parse(req.body);
    const table = await tablesService.create(data);
    res.status(201).json({ table });
  },

  async update(req: Request, res: Response) {
    const { id } = idParamSchema.parse(req.params);
    const data = updateSchema.parse(req.body);
    const table = await tablesService.update(id, data);
    res.json({ table });
  },

  async remove(req: Request, res: Response) {
    const { id } = idParamSchema.parse(req.params);
    await tablesService.remove(id);
    res.status(204).send();
  },

  // ── Acciones de estado ──
  async open(req: Request, res: Response) {
    const { id } = idParamSchema.parse(req.params);
    const { guestCount } = openSchema.parse(req.body);
    const table = await tablesService.open(id, guestCount);
    res.json({ table });
  },

  async requestBill(req: Request, res: Response) {
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.requestBill(id);
    res.json({ table });
  },

  async close(req: Request, res: Response) {
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.close(id);
    res.json({ table });
  },

  async reserve(req: Request, res: Response) {
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.reserve(id);
    res.json({ table });
  },

  async cancelReservation(req: Request, res: Response) {
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.cancelReservation(id);
    res.json({ table });
  },

  async toggleEnabled(req: Request, res: Response) {
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.toggleEnabled(id);
    res.json({ table });
  },
};
