import { Router } from 'express';
import { takeawayController } from './takeaway.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

// Lectura: cualquier rol autenticado
router.get('/',     asyncHandler(takeawayController.list));
router.get('/:id',  asyncHandler(takeawayController.getById));

// Escritura: cualquier rol autenticado (meseros también crean pedidos)
router.post('/',              asyncHandler(takeawayController.create));
router.post('/:id/ready',     asyncHandler(takeawayController.markReady));
router.post('/:id/pay',       asyncHandler(takeawayController.pay));
router.post('/:id/cancel',    asyncHandler(takeawayController.cancel));
router.delete('/:id',         requireRole('ADMIN'), asyncHandler(takeawayController.remove));

export { router as takeawayRouter };
