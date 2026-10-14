import { Router } from 'express';
import { sectionsController } from './sections.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/', asyncHandler(sectionsController.list));

router.use(requirePermission('tables.manage'));
router.post('/',         asyncHandler(sectionsController.create));
router.patch('/:id',     asyncHandler(sectionsController.update));
router.delete('/:id',    asyncHandler(sectionsController.remove));

export { router as sectionsRouter };
