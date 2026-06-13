// ──────────────────────────────────────────────
// sales.routes.ts — Endpoints de ventas
// Listado/reportes: solo ADMIN y STAFF.
// Crear venta (cobrar y cerrar mesa): cualquier rol autenticado,
// incluidos los meseros — el cobro queda registrado para que
// administradores y personal lo vean en reportes.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { salesController } from './sales.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/',              requireRole('ADMIN', 'STAFF'), asyncHandler(salesController.list));
router.get('/stats/daily',   requireRole('ADMIN', 'STAFF'), asyncHandler(salesController.dailyStats));
router.get('/:id',           requireRole('ADMIN', 'STAFF'), asyncHandler(salesController.getById));
router.post('/',             asyncHandler(salesController.create));

export { router as salesRouter };