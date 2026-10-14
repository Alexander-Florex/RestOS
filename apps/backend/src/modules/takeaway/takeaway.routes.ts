import { Router } from 'express';
import { takeawayController } from './takeaway.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/',                asyncHandler(takeawayController.list));
router.get('/:id',             asyncHandler(takeawayController.getById));
router.post('/',               asyncHandler(takeawayController.create));
router.post('/:id/ready',      asyncHandler(takeawayController.markReady));
router.post('/:id/pay',        requirePermission('sales.charge'), asyncHandler(takeawayController.pay));
router.post('/:id/cancel',     requirePermission('takeaway.cancel'), asyncHandler(takeawayController.cancel));
router.delete('/:id',          requirePermission('takeaway.delete'), asyncHandler(takeawayController.remove));

export { router as takeawayRouter };
