// ──────────────────────────────────────────────
// users.routes.ts — Endpoints de gestión de usuarios (login)
// Solo ADMIN.
// ──────────────────────────────────────────────
import { Router } from 'express';
import { usersController } from './users.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('ADMIN'));

router.get('/',      asyncHandler(usersController.list));
router.get('/:id',   asyncHandler(usersController.getById));
router.post('/',     asyncHandler(usersController.create));
router.patch('/:id', asyncHandler(usersController.update));
router.delete('/:id', asyncHandler(usersController.remove));
router.post('/:id/toggle', asyncHandler(usersController.toggleActive));

export { router as usersRouter };
