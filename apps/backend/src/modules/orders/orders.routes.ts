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
// Anular (con motivo). Los pedidos no se borran: quedan en el historial (tarea 1.3)
router.post('/:id/cancel',     requirePermission('orders.delete'), asyncHandler(ordersController.cancel));

export { router as ordersRouter };
