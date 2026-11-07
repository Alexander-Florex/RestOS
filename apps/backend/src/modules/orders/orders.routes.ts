// ──────────────────────────────────────────────
// orders.routes.ts — Endpoints de pedidos
// ──────────────────────────────────────────────
import { Router } from 'express';
import { ordersController } from './orders.controller.js';
import { orderChangesController } from './order-changes.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

// ── Cambios de platos (tarea 5.8) — antes de '/:id' para que no choquen ──
// Pedir o hacer: quien toma pedidos. Aprobar/rechazar: Caja o Administrador.
router.get('/changes',               requirePermission('orders.create', 'orders.change.approve'), asyncHandler(orderChangesController.list));
router.post('/changes/:id/approve',  requirePermission('orders.change.approve'), asyncHandler(orderChangesController.approve));
router.post('/changes/:id/reject',   requirePermission('orders.change.approve'), asyncHandler(orderChangesController.reject));
router.post('/items/:itemId/remake', requirePermission('orders.create'), asyncHandler(orderChangesController.remake));
router.post('/items/:itemId/replace', requirePermission('orders.create'), asyncHandler(orderChangesController.replace));

// Lectura general — admin y staff
router.get('/',                requirePermission('orders.view'), asyncHandler(ordersController.list));
router.get('/:id',             asyncHandler(ordersController.getById));

// Lectura por mesa — todos los roles (el mesero la necesita)
router.get('/table/:tableId',  asyncHandler(ordersController.listByTable));

// Crear pedido — admin, staff y mesero
router.post('/',               requirePermission('orders.create'), asyncHandler(ordersController.create));

// Anular (con motivo). Los pedidos no se borran: quedan en el historial (tarea 1.3)
router.post('/:id/cancel',     requirePermission('orders.delete'), asyncHandler(ordersController.cancel));

export { router as ordersRouter };
