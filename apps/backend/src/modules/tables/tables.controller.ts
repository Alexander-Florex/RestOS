// ──────────────────────────────────────────────
// tables.controller.ts — Handlers HTTP de mesas
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { tablesService, getTableLabelMode } from './tables.service.js';
import { HttpError } from '../../lib/http-error.js';

const nameSchema = z.string().max(40, 'El nombre de la mesa puede tener hasta 40 letras').optional().nullable();

const createSchema = z.object({
  number:    z.coerce.number().int().positive('El número debe ser positivo'),
  name:      nameSchema,
  capacity:  z.coerce.number().int().min(1, 'Mínimo 1 comensal').max(500).optional(),
  sectionId: z.coerce.number().int().positive().optional().nullable(),
});

const labelModeSchema = z.object({ mode: z.enum(['NAME', 'NUMBER']) });

const joinSchema = z.object({
  tableIds: z.array(z.coerce.number().int().positive()).min(1, 'Elegí al menos otra mesa').max(20),
});

const updateSchema = z.object({
  number:    z.coerce.number().int().positive().optional(),
  name:      nameSchema,
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
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const [tables, labelMode] = await Promise.all([
      tablesService.list(req.user.restaurantId),
      getTableLabelMode(req.user.restaurantId),
    ]);
    res.json({ tables, labelMode });
  },

  async setLabelMode(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { mode } = labelModeSchema.parse(req.body);
    const labelMode = await tablesService.setLabelMode(req.user.restaurantId, mode);
    res.json({ labelMode });
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.getById(req.user.restaurantId, id);
    res.json({ table });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    const table = await tablesService.create(req.user.restaurantId, data);
    res.status(201).json({ table });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParamSchema.parse(req.params);
    const data = updateSchema.parse(req.body);
    const table = await tablesService.update(req.user.restaurantId, id, data);
    res.json({ table });
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParamSchema.parse(req.params);
    await tablesService.remove(req.user.restaurantId, id);
    res.status(204).send();
  },

  // ── Acciones de estado ──
  async open(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParamSchema.parse(req.params);
    const { guestCount } = openSchema.parse(req.body);
    const table = await tablesService.open(req.user.restaurantId, id, guestCount);
    res.json({ table });
  },

  async requestBill(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.requestBill(req.user.restaurantId, id);
    res.json({ table });
  },

  async close(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.close(req.user.restaurantId, id);
    res.json({ table });
  },

  async reserve(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.reserve(req.user.restaurantId, id);
    res.json({ table });
  },

  async cancelReservation(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.cancelReservation(req.user.restaurantId, id);
    res.json({ table });
  },

  async join(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParamSchema.parse(req.params);
    const { tableIds } = joinSchema.parse(req.body);
    const tables = await tablesService.join(req.user.restaurantId, id, tableIds);
    res.json({ tables });
  },

  async separate(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParamSchema.parse(req.params);
    const tables = await tablesService.separate(req.user.restaurantId, id);
    res.json({ tables });
  },

  async toggleEnabled(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParamSchema.parse(req.params);
    const table = await tablesService.toggleEnabled(req.user.restaurantId, id);
    res.json({ table });
  },
};
