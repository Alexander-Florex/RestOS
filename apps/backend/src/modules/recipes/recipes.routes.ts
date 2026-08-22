// ──────────────────────────────────────────────
// recipes.routes.ts — Endpoints de recetas y costos
// Solo ADMIN (info de costos internos, no operativa de piso).
// ──────────────────────────────────────────────
import { Router } from 'express';
import { recipesController } from './recipes.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate, requireRole('ADMIN'));

router.get('/',       asyncHandler(recipesController.list));
router.get('/:id',    asyncHandler(recipesController.getById));
router.post('/',      asyncHandler(recipesController.create));
router.patch('/:id',  asyncHandler(recipesController.update));
router.delete('/:id', asyncHandler(recipesController.remove));

export { router as recipesRouter };
