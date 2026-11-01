// ──────────────────────────────────────────────
// reports.routes.ts — Endpoints de reportes (permiso reports.view)
// Todo con el header Authorization: el token nunca va en la URL (quedaría
// en logs, historial y proxies). El frontend descarga el CSV con fetch.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { reportsController } from './reports.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate, requirePermission('reports.view'));

router.get('/sales',     asyncHandler(reportsController.salesReport));
router.get('/top-items', asyncHandler(reportsController.topItems));
router.get('/tickets',   asyncHandler(reportsController.dailyTickets));
router.get('/sales.csv', asyncHandler(reportsController.salesCsv));

export { router as reportsRouter };
