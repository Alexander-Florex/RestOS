// ──────────────────────────────────────────────
// menu-categories.routes.ts — Endpoints de categorías del menú
// Lectura: cualquier rol autenticado. CRUD: ADMIN.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { menuCategoriesController } from './menu-categories.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/',       asyncHandler(menuCategoriesController.list));
router.post('/',      requireRole('ADMIN'), asyncHandler(menuCategoriesController.create));
router.patch('/:id',  requireRole('ADMIN'), asyncHandler(menuCategoriesController.update));
router.delete('/:id', requireRole('ADMIN'), asyncHandler(menuCategoriesController.remove));

export { router as menuCategoriesRouter };
