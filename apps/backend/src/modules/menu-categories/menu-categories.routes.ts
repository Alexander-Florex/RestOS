// ──────────────────────────────────────────────
// menu-categories.routes.ts — Endpoints de categorías del menú
// Lectura: cualquier rol autenticado. CRUD: ADMIN.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { menuCategoriesController } from './menu-categories.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/',       asyncHandler(menuCategoriesController.list));
router.post('/',      requirePermission('menu.manage'), asyncHandler(menuCategoriesController.create));
router.patch('/:id',  requirePermission('menu.manage'), asyncHandler(menuCategoriesController.update));
router.delete('/:id', requirePermission('menu.manage'), asyncHandler(menuCategoriesController.remove));

export { router as menuCategoriesRouter };
