// ──────────────────────────────────────────────
// inventory.routes.ts — Endpoints de inventario
// Lectura y reabastecimiento: ADMIN/STAFF.
// CRUD estructural: solo ADMIN.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { inventoryController } from './inventory.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission('inventory.view'));

router.get('/',     asyncHandler(inventoryController.list));
router.get('/:id',  asyncHandler(inventoryController.getById));

router.post('/',           requirePermission('inventory.manage'), asyncHandler(inventoryController.create));
router.patch('/:id',       requirePermission('inventory.manage'), asyncHandler(inventoryController.update));
router.delete('/:id',      requirePermission('inventory.manage'), asyncHandler(inventoryController.remove));

// ADMIN y STAFF pueden reabastecer / consumir (operativo del día)
router.post('/:id/restock', requirePermission('inventory.adjust'), asyncHandler(inventoryController.restock));
router.post('/:id/consume', requirePermission('inventory.adjust'), asyncHandler(inventoryController.consume));

export { router as inventoryRouter };
