// ──────────────────────────────────────────────
// reports.routes.ts — Endpoints de reportes (permiso reports.view)
// Todo con el header Authorization: el token nunca va en la URL (quedaría
// en logs, historial y proxies). El frontend descarga el CSV con fetch.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { reportsController } from './reports.controller.js';
import { analyticsController } from './analytics.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate, requirePermission('reports.view'));

router.get('/sales',     asyncHandler(reportsController.salesReport));
router.get('/top-items', asyncHandler(reportsController.topItems));
router.get('/tickets',   asyncHandler(reportsController.dailyTickets));
router.get('/sales.csv', asyncHandler(reportsController.salesCsv));
// Fase 4: rentabilidad, real vs teórico, cierre del día y panel del dueño
router.get('/profitability',        asyncHandler(analyticsController.profitability));
router.get('/theoretical-vs-real',  asyncHandler(analyticsController.theoreticalVsReal));
router.get('/daily-close',          asyncHandler(analyticsController.dailyClose));
router.get('/daily-close.csv',      asyncHandler(analyticsController.dailyCloseCsv));
router.get('/owner',                asyncHandler(analyticsController.owner));

export { router as reportsRouter };
