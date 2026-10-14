// ──────────────────────────────────────────────
// users.routes.ts — Endpoints de gestión de usuarios (login)
// Requiere el permiso users.manage.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { usersController } from './users.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission('users.manage'));

router.get('/',      asyncHandler(usersController.list));
router.get('/:id',   asyncHandler(usersController.getById));
router.post('/',     asyncHandler(usersController.create));
router.patch('/:id', asyncHandler(usersController.update));
router.delete('/:id', asyncHandler(usersController.remove));
router.post('/:id/toggle', asyncHandler(usersController.toggleActive));

export { router as usersRouter };
