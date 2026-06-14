// ──────────────────────────────────────────────
// users.controller.ts — Handlers HTTP de gestión de usuarios
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { usersService } from './users.service.js';
import { HttpError } from '../../lib/http-error.js';

const roleEnum = z.nativeEnum(UserRole);

const createSchema = z.object({
  username: z.string().trim().min(3, 'Mínimo 3 caracteres').max(50),
  email:    z.string().email('Email inválido').trim(),
  password: z.string().min(4, 'Mínimo 4 caracteres'),
  name:     z.string().trim().min(1, 'Nombre requerido'),
  role:     roleEnum,
  active:   z.boolean().optional(),
});

const updateSchema = z.object({
  username: z.string().trim().min(3).max(50).optional(),
  email:    z.string().email('Email inválido').trim().optional(),
  password: z.string().min(4, 'Mínimo 4 caracteres').optional(),
  name:     z.string().trim().min(1).optional(),
  role:     roleEnum.optional(),
  active:   z.boolean().optional(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

export const usersController = {
  async list(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const users = await usersService.list(req.user.restaurantId);
    res.json({ users });
  },

  async getById(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const user = await usersService.getById(req.user.restaurantId, id);
    res.json({ user });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const data = createSchema.parse(req.body);
    const user = await usersService.create(req.user.restaurantId, data);
    res.status(201).json({ user });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const data = updateSchema.parse(req.body);
    const user = await usersService.update(req.user.restaurantId, id, req.user.userId, data);
    res.json({ user });
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await usersService.remove(req.user.restaurantId, id, req.user.userId);
    res.status(204).send();
  },

  async toggleActive(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const user = await usersService.toggleActive(req.user.restaurantId, id, req.user.userId);
    res.json({ user });
  },
};
