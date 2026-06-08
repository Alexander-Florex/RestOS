// ──────────────────────────────────────────────
// staff.routes.ts — Endpoints de personal
// Solo ADMIN — gestión de equipo.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { staffController } from './staff.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('ADMIN'));

router.get('/',     asyncHandler(staffController.list));
router.get('/:id',  asyncHandler(staffController.getById));
router.post('/',    asyncHandler(staffController.create));
router.patch('/:id',  asyncHandler(staffController.update));
router.delete('/:id', asyncHandler(staffController.remove));
router.post('/:id/toggle',         asyncHandler(staffController.toggleActive));

// ── ARCA — consulta pública del padrón ──
router.get('/:id/arca',            asyncHandler(staffController.queryArca));
router.delete('/:id/arca-cache',   asyncHandler(staffController.invalidateArcaCache));

export { router as staffRouter };
