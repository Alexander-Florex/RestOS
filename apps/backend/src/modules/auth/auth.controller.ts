// ──────────────────────────────────────────────
// auth.controller.ts — Handlers HTTP para auth
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { authService } from './auth.service.js';
import { HttpError } from '../../lib/http-error.js';

const loginSchema = z.object({
  username: z.string().min(1, 'Usuario requerido').trim(),
  password: z.string().min(1, 'Contraseña requerida'),
});

export const authController = {
  async login(req: Request, res: Response) {
    const { username, password } = loginSchema.parse(req.body);
    const { user, token } = await authService.login(username, password);
    res.json({ user, token });
  },

  async me(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const user = await authService.getMe(req.user.userId);
    res.json({ user });
  },
};
