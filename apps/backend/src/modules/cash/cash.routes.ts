// ──────────────────────────────────────────────
// cash.routes.ts — Caja (tarea 5.1)
// Ver el estado: quien cobra. Abrir, ingresos/egresos y cerrar: "Abrir y cerrar caja"
// (cash.manage; Cajero y Administrador por defecto).
// ──────────────────────────────────────────────
import { Router } from 'express';
import { cashController } from './cash.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/current',    requirePermission('cash.manage', 'sales.charge'), asyncHandler(cashController.current));
router.get('/history',    requirePermission('cash.manage'), asyncHandler(cashController.history));
router.post('/open',      requirePermission('cash.manage'), asyncHandler(cashController.open));
router.post('/movements', requirePermission('cash.manage'), asyncHandler(cashController.movement));
router.post('/close',     requirePermission('cash.manage'), asyncHandler(cashController.close));

export { router as cashRouter };
