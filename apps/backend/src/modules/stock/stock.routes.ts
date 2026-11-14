// ──────────────────────────────────────────────
// stock.routes.ts — Fase 3: stock automático, producción, mermas, compras y proveedores
// ──────────────────────────────────────────────
import { Router } from 'express';
import { stockController } from './stock.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/settings',            requirePermission('inventory.view'), asyncHandler(stockController.settings));
router.put('/settings',            requirePermission('inventory.manage'), asyncHandler(stockController.setSettings));
router.post('/production',         requirePermission('inventory.adjust'), asyncHandler(stockController.produce));
router.post('/items/:id/waste',    requirePermission('inventory.adjust'), asyncHandler(stockController.waste));
router.get('/shopping-list',       requirePermission('inventory.view'), asyncHandler(stockController.shoppingList));
router.get('/unrecipe-sales',      requirePermission('inventory.view'), asyncHandler(stockController.unrecipedSales));

router.get('/suppliers',           requirePermission('inventory.view'), asyncHandler(stockController.listSuppliers));
router.post('/suppliers',          requirePermission('inventory.manage'), asyncHandler(stockController.createSupplier));
router.patch('/suppliers/:id',     requirePermission('inventory.manage'), asyncHandler(stockController.updateSupplier));
router.delete('/suppliers/:id',    requirePermission('inventory.manage'), asyncHandler(stockController.deleteSupplier));

export { router as stockRouter };
