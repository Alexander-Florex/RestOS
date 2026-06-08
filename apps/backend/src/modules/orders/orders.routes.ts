// ──────────────────────────────────────────────
// orders.routes.ts — Endpoints de pedidos
// ──────────────────────────────────────────────
import { Router } from 'express';
import { ordersController } from './orders.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

// Lectura general — admin y staff
router.get('/',                requireRole('ADMIN', 'STAFF'), asyncHandler(ordersController.list));
router.get('/:id',             requireRole('ADMIN', 'STAFF', 'WAITER'), asyncHandler(ordersController.getById));

// Lectura por mesa — todos los roles (el mesero la necesita)
router.get('/table/:tableId',  asyncHandler(ordersController.listByTable));

// Crear pedido — admin, staff y mesero
router.post('/',               requireRole('ADMIN', 'STAFF', 'WAITER'), asyncHandler(ordersController.create));

// Borrar — solo admin/staff
router.delete('/:id',          requireRole('ADMIN', 'STAFF'), asyncHandler(ordersController.remove));

export { router as ordersRouter };
