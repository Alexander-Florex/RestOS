// ──────────────────────────────────────────────
// tables.routes.ts — Endpoints de mesas
// Lectura: cualquier usuario autenticado.
// CRUD estructural: solo ADMIN.
// Acciones de estado: ADMIN o STAFF (no WAITER porque tiene su propia vista).
// ──────────────────────────────────────────────
import { Router } from 'express';
import { tablesController } from './tables.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();

// Todos los endpoints requieren autenticación
router.use(authenticate);

// ── Lectura — cualquier rol ──
router.get('/',     asyncHandler(tablesController.list));
router.get('/:id',  asyncHandler(tablesController.getById));

// ── CRUD estructural — solo ADMIN ──
router.post('/',                requirePermission('tables.manage'), asyncHandler(tablesController.create));
router.patch('/:id',            requirePermission('tables.manage'), asyncHandler(tablesController.update));
router.delete('/:id',           requirePermission('tables.manage'), asyncHandler(tablesController.remove));
router.post('/:id/toggle',      requirePermission('tables.manage'), asyncHandler(tablesController.toggleEnabled));

// ── Acciones de estado — ADMIN o STAFF ──
router.post('/:id/open',                requirePermission('tables.operate'), asyncHandler(tablesController.open));
router.post('/:id/request-bill',        requirePermission('tables.operate'), asyncHandler(tablesController.requestBill));
router.post('/:id/close',               requirePermission('tables.operate'), asyncHandler(tablesController.close));
router.post('/:id/reserve',             requirePermission('tables.operate'), asyncHandler(tablesController.reserve));
router.post('/:id/cancel-reservation',  requirePermission('tables.operate'), asyncHandler(tablesController.cancelReservation));

export { router as tablesRouter };
