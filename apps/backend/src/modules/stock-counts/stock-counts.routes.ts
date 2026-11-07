// ──────────────────────────────────────────────
// stock-counts.routes.ts — Toma de inventario (tarea 3.3)
// Todo con el permiso inventory.count ("Contar stock").
// ──────────────────────────────────────────────
import { Router } from 'express';
import { stockCountsController } from './stock-counts.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission('inventory.count'));

router.get('/',                   asyncHandler(stockCountsController.list));
router.post('/',                  asyncHandler(stockCountsController.create));
router.get('/:id',                asyncHandler(stockCountsController.get));
router.get('/:id/summary',        asyncHandler(stockCountsController.summary));
router.put('/:id/lines/:lineId',  asyncHandler(stockCountsController.setLine));
router.post('/:id/close',         asyncHandler(stockCountsController.close));
router.post('/:id/cancel',        asyncHandler(stockCountsController.cancel));

export { router as stockCountsRouter };
