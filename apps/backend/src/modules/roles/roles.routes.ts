// ──────────────────────────────────────────────
// roles.routes.ts — Endpoints de roles (requiere users.manage)
// ──────────────────────────────────────────────
import { Router } from 'express';
import { rolesController } from './roles.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);
router.use(requirePermission('users.manage'));

router.get('/permissions', asyncHandler(rolesController.permissions));
router.get('/',            asyncHandler(rolesController.list));
router.post('/',           asyncHandler(rolesController.create));
router.patch('/:id',       asyncHandler(rolesController.update));
router.delete('/:id',      asyncHandler(rolesController.remove));

export { router as rolesRouter };
