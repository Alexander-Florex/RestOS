// ──────────────────────────────────────────────
// menu.routes.ts — Endpoints del menú
// Lectura: cualquier rol autenticado (incluido WAITER, que ve el menú para tomar pedidos).
// CRUD: ADMIN.
// Stock y toggle: ADMIN o STAFF (control operativo del día).
// ──────────────────────────────────────────────
import { Router } from 'express';
import { menuController } from './menu.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/',    asyncHandler(menuController.list));
router.get('/:id', asyncHandler(menuController.getById));

router.post('/',         requireRole('ADMIN'), asyncHandler(menuController.create));
router.patch('/:id',     requireRole('ADMIN'), asyncHandler(menuController.update));
router.delete('/:id',    requireRole('ADMIN'), asyncHandler(menuController.remove));

router.post('/:id/toggle',     requireRole('ADMIN', 'STAFF'), asyncHandler(menuController.toggleEnabled));
router.patch('/:id/stock',     requireRole('ADMIN', 'STAFF'), asyncHandler(menuController.setStock));

export { router as menuRouter };
