// ──────────────────────────────────────────────
// staff-shifts.routes.ts — Horarios del personal
// Permiso "Registrar horarios" (staff.hours): por defecto solo Administrador.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { staffShiftsController } from './staff-shifts.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission('staff.hours'));

router.get('/week',                 asyncHandler(staffShiftsController.week));
router.get('/week.csv',             asyncHandler(staffShiftsController.weekCsv));
router.post('/staff/:id/clock-in',  asyncHandler(staffShiftsController.clockIn));
router.post('/staff/:id/clock-out', asyncHandler(staffShiftsController.clockOut));
router.post('/',                    asyncHandler(staffShiftsController.create));
router.patch('/:id',                asyncHandler(staffShiftsController.update));
router.delete('/:id',               asyncHandler(staffShiftsController.remove));

export { router as staffShiftsRouter };
