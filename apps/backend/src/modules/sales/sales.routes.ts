// ──────────────────────────────────────────────
// sales.routes.ts — Endpoints de ventas
// Listado/reportes: solo ADMIN y STAFF.
// Crear venta (cobrar y cerrar mesa): cualquier rol autenticado,
// incluidos los meseros — el cobro queda registrado para que
// administradores y personal lo vean en reportes.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { salesController } from './sales.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/',              requirePermission('sales.view'), asyncHandler(salesController.list));
router.get('/stats/daily',   requirePermission('sales.view'), asyncHandler(salesController.dailyStats));
router.get('/:id',           requirePermission('sales.view'), asyncHandler(salesController.getById));
router.post('/',             requirePermission('sales.charge'), asyncHandler(salesController.create));

export { router as salesRouter };