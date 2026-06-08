// ──────────────────────────────────────────────
// sales.routes.ts — Endpoints de ventas
// Solo ADMIN y STAFF — los meseros no cobran ni ven las ventas.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { salesController } from './sales.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('ADMIN', 'STAFF'));

router.get('/',              asyncHandler(salesController.list));
router.get('/stats/daily',   asyncHandler(salesController.dailyStats));
router.get('/:id',           asyncHandler(salesController.getById));
router.post('/',             asyncHandler(salesController.create));

export { router as salesRouter };
