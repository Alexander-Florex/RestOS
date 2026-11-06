// ──────────────────────────────────────────────
// system.routes.ts — Estado del servidor del local (tarea 6.3)
// GET /api/system/backup: cómo viene el respaldo nocturno (permiso system.backup).
// Es del servidor, no de un restaurante: no tiene datos de ventas ni clientes.
// ──────────────────────────────────────────────
import { Router, type Request, type Response } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { backupStatus } from '../../lib/backup/status.js';

const router = Router();
router.use(authenticate, requirePermission('system.backup'));

router.get('/backup', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ backup: await backupStatus() });
}));

export { router as systemRouter };
