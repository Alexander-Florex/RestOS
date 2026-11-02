// ──────────────────────────────────────────────
// recipes.routes.ts — Endpoints de recetas y costos
// Solo ADMIN (info de costos internos, no operativa de piso).
// ──────────────────────────────────────────────
import { Router } from 'express';
import { recipesController } from './recipes.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate, requirePermission('recipes.manage'));

router.get('/',       asyncHandler(recipesController.list));
// Antes de '/:id': costo y margen de los platos de la carta
router.get('/menu-costs', asyncHandler(recipesController.menuCosts));
router.get('/cost-alerts', asyncHandler(recipesController.costAlerts));
router.get('/:id',    asyncHandler(recipesController.getById));
router.post('/',      asyncHandler(recipesController.create));
router.patch('/:id',  asyncHandler(recipesController.update));
router.delete('/:id', asyncHandler(recipesController.remove));

export { router as recipesRouter };
