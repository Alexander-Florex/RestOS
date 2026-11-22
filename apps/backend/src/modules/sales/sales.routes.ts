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
// El detalle se abre desde Ventas, Inicio y Reportes: alcanza con cualquiera de los dos permisos
router.get('/:id/detail',    requirePermission('sales.view', 'reports.view'), asyncHandler(salesController.detail));
router.get('/:id/receipt',   requirePermission('sales.view'), asyncHandler(salesController.receipt));
router.post('/',             requirePermission('sales.charge'), asyncHandler(salesController.create));

export { router as salesRouter };