// ──────────────────────────────────────────────
// staff.controller.ts — Handlers HTTP de personal + ARCA
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { StaffRole } from '@prisma/client';
import { staffService } from './staff.service.js';

const roleEnum = z.nativeEnum(StaffRole);

const createSchema = z.object({
  name:   z.string().min(1, 'Nombre requerido').trim(),
  email:  z.string().email('Email inválido').trim(),
  role:   roleEnum,
  phone:  z.string().trim().optional().nullable(),
  active: z.boolean().optional(),
  cuit:   z.string().trim().optional().nullable(),
});

const updateSchema = createSchema.partial();
const idParam = z.object({ id: z.coerce.number().int().positive() });
const listQuery = z.object({
  role:       roleEnum.optional(),
  activeOnly: z.coerce.boolean().optional(),
});

export const staffController = {
  async list(req: Request, res: Response) {
    const opts = listQuery.parse(req.query);
    const members = await staffService.list(opts);
    res.json({ members });
  },

  async getById(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const member = await staffService.getById(id);
    res.json({ member });
  },

  async create(req: Request, res: Response) {
    const data = createSchema.parse(req.body);
    const member = await staffService.create({
      ...data,
      phone: data.phone ?? undefined,
      cuit:  data.cuit ?? undefined,
    });
    res.status(201).json({ member });
  },

  async update(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    const member = await staffService.update(id, {
      ...data,
      phone: data.phone ?? undefined,
      cuit:  data.cuit ?? undefined,
    });
    res.json({ member });
  },

  async remove(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    await staffService.remove(id);
    res.status(204).send();
  },

  async toggleActive(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const member = await staffService.toggleActive(id);
    res.json({ member });
  },

  /** GET /api/staff/:id/arca — consulta padrón ARCA y devuelve estado de inscripción */
  async queryArca(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const data = await staffService.queryArca(id);
    res.json({ arca: data });
  },

  /** DELETE /api/staff/:id/arca-cache — fuerza re-consulta en la próxima llamada */
  async invalidateArcaCache(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    await staffService.invalidateArcaCache(id);
    res.json({ message: 'Caché de ARCA limpiado. La próxima consulta irá directo a ARCA.' });
  },
};
