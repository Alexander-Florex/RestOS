// ──────────────────────────────────────────────
// inventory.routes.ts — Endpoints de inventario
// Lectura y reabastecimiento: ADMIN/STAFF.
// CRUD estructural: solo ADMIN.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { inventoryController } from './inventory.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('ADMIN', 'STAFF'));

router.get('/',     asyncHandler(inventoryController.list));
router.get('/:id',  asyncHandler(inventoryController.getById));

router.post('/',           requireRole('ADMIN'), asyncHandler(inventoryController.create));
router.patch('/:id',       requireRole('ADMIN'), asyncHandler(inventoryController.update));
router.delete('/:id',      requireRole('ADMIN'), asyncHandler(inventoryController.remove));

// ADMIN y STAFF pueden reabastecer / consumir (operativo del día)
router.post('/:id/restock', asyncHandler(inventoryController.restock));
router.post('/:id/consume', asyncHandler(inventoryController.consume));

export { router as inventoryRouter };
