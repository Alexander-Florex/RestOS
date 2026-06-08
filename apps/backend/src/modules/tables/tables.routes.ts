// ──────────────────────────────────────────────
// tables.routes.ts — Endpoints de mesas
// Lectura: cualquier usuario autenticado.
// CRUD estructural: solo ADMIN.
// Acciones de estado: ADMIN o STAFF (no WAITER porque tiene su propia vista).
// ──────────────────────────────────────────────
import { Router } from 'express';
import { tablesController } from './tables.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();

// Todos los endpoints requieren autenticación
router.use(authenticate);

// ── Lectura — cualquier rol ──
router.get('/',     asyncHandler(tablesController.list));
router.get('/:id',  asyncHandler(tablesController.getById));

// ── CRUD estructural — solo ADMIN ──
router.post('/',                requireRole('ADMIN'), asyncHandler(tablesController.create));
router.patch('/:id',            requireRole('ADMIN'), asyncHandler(tablesController.update));
router.delete('/:id',           requireRole('ADMIN'), asyncHandler(tablesController.remove));
router.post('/:id/toggle',      requireRole('ADMIN'), asyncHandler(tablesController.toggleEnabled));

// ── Acciones de estado — ADMIN o STAFF ──
router.post('/:id/open',                requireRole('ADMIN', 'STAFF'), asyncHandler(tablesController.open));
router.post('/:id/request-bill',        requireRole('ADMIN', 'STAFF'), asyncHandler(tablesController.requestBill));
router.post('/:id/close',               requireRole('ADMIN', 'STAFF'), asyncHandler(tablesController.close));
router.post('/:id/reserve',             requireRole('ADMIN', 'STAFF'), asyncHandler(tablesController.reserve));
router.post('/:id/cancel-reservation',  requireRole('ADMIN', 'STAFF'), asyncHandler(tablesController.cancelReservation));

export { router as tablesRouter };
