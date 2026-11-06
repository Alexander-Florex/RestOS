// ──────────────────────────────────────────────
// storage-areas.routes.ts — Sectores de guardado (tarea 3.1)
// Ver: quien ve el inventario o cuenta stock. Editar: inventory.manage.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { storageAreasController } from './storage-areas.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('inventory.view', 'inventory.count'), asyncHandler(storageAreasController.list));

router.use(requirePermission('inventory.manage'));
router.post('/',      asyncHandler(storageAreasController.create));
router.patch('/:id',  asyncHandler(storageAreasController.update));
router.delete('/:id', asyncHandler(storageAreasController.remove));

export { router as storageAreasRouter };
