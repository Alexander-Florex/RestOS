// ──────────────────────────────────────────────
// reports.routes.ts — Endpoints de reportes
// Solo ADMIN/STAFF.
// El CSV acepta el token por query string (?token=...) para que el navegador
// pueda descargarlo directamente con <a download>.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { reportsController } from './reports.controller.js';
import { authenticate, requireRole, authenticateFromQuery } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();

// JSON: header Authorization estándar
router.get('/sales',     authenticate, requireRole('ADMIN', 'STAFF'), asyncHandler(reportsController.salesReport));
router.get('/top-items', authenticate, requireRole('ADMIN', 'STAFF'), asyncHandler(reportsController.topItems));

// Descarga de CSV: acepta token por query (no se puede setear header en una redirección de <a>)
router.get('/sales.csv', authenticateFromQuery, requireRole('ADMIN', 'STAFF'), asyncHandler(reportsController.salesCsv));

export { router as reportsRouter };
