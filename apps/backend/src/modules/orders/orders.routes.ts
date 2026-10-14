// ──────────────────────────────────────────────
// orders.routes.ts — Endpoints de pedidos
// ──────────────────────────────────────────────
import { Router } from 'express';
import { ordersController } from './orders.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

// Lectura general — admin y staff
router.get('/',                requirePermission('orders.view'), asyncHandler(ordersController.list));
router.get('/:id',             asyncHandler(ordersController.getById));

// Lectura por mesa — todos los roles (el mesero la necesita)
router.get('/table/:tableId',  asyncHandler(ordersController.listByTable));

// Crear pedido — admin, staff y mesero
router.post('/',               requirePermission('orders.create'), asyncHandler(ordersController.create));

// Borrar — solo admin/staff
router.delete('/:id',          requirePermission('orders.delete'), asyncHandler(ordersController.remove));

export { router as ordersRouter };
