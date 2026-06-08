// ──────────────────────────────────────────────
// reservations.routes.ts — Endpoints de reservas
// Cualquier rol con auth puede leer; ADMIN/STAFF puede modificar.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { reservationsController } from './reservations.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

// Lectura: cualquier rol (los meseros también pueden ver las reservas del día)
router.get('/',          asyncHandler(reservationsController.list));
router.get('/upcoming',  asyncHandler(reservationsController.upcoming));
router.get('/:id',       asyncHandler(reservationsController.getById));

// Modificación: ADMIN o STAFF
router.use(requireRole('ADMIN', 'STAFF'));

router.post('/',                       asyncHandler(reservationsController.create));
router.patch('/:id',                   asyncHandler(reservationsController.update));
router.delete('/:id',                  asyncHandler(reservationsController.remove));
router.post('/:id/cancel',             asyncHandler(reservationsController.cancel));
router.post('/:id/no-show',            asyncHandler(reservationsController.noShow));
router.post('/:id/seat',               asyncHandler(reservationsController.seat));
router.post('/:id/mark-table-reserved', asyncHandler(reservationsController.markTableReserved));

export { router as reservationsRouter };
