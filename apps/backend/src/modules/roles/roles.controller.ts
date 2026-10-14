// ──────────────────────────────────────────────
// roles.controller.ts — Handlers HTTP de roles y permisos
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { rolesService } from './roles.service.js';
import { PERMISSIONS } from '../../lib/permissions.js';
import { HttpError } from '../../lib/http-error.js';

const createSchema = z.object({
  name:        z.string().trim().min(2, 'Mínimo 2 caracteres').max(40, 'Máximo 40 caracteres'),
  permissions: z.array(z.string()).default([]),
});

const updateSchema = z.object({
  name:        z.string().trim().min(2, 'Mínimo 2 caracteres').max(40, 'Máximo 40 caracteres').optional(),
  permissions: z.array(z.string()).optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

export const rolesController = {
  async permissions(_req: Request, res: Response) {
    res.json({ permissions: PERMISSIONS });
  },

  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    res.json({ roles: await rolesService.list(req.user.restaurantId) });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    res.status(201).json({ role: await rolesService.create(req.user.restaurantId, data) });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    res.json({ role: await rolesService.update(req.user.restaurantId, id, data) });
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await rolesService.remove(req.user.restaurantId, id);
    res.status(204).send();
  },
};
