// ──────────────────────────────────────────────
// audit.routes.ts — Registro de auditoría (permiso audit.view; por defecto
// solo el Administrador). Solo lectura: no hay forma de editar ni borrar.
// ──────────────────────────────────────────────
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { HttpError } from '../../lib/http-error.js';
import { rangeParams } from '../../lib/date-query.js';
import { addDays, localDayKey, localDaysRange } from '../../lib/time.js';
import { auditService } from './audit.service.js';

const listQuery = z.object({
  action: z.string().trim().max(200).regex(/^[a-z.,]+$/).optional(),
  userId: z.coerce.number().int().positive().optional(),
  entity: z.string().trim().max(40).regex(/^[A-Za-z]+$/).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const router = Router();
router.use(authenticate, requirePermission('audit.view'));

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw HttpError.unauthorized();
  const filters = listQuery.parse(req.query);
  // Sin rango: los últimos 7 días (hora del local)
  const range = req.query.from || req.query.to
    ? rangeParams.parse(req.query)
    : localDaysRange(addDays(localDayKey(new Date()), -6), localDayKey(new Date()));
  res.json(await auditService.list(req.user.restaurantId, { ...filters, ...range }));
}));

router.get('/actors', asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw HttpError.unauthorized();
  res.json({ actors: await auditService.actors(req.user.restaurantId) });
}));

export { router as auditRouter };
