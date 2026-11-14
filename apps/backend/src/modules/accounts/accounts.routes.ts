// ──────────────────────────────────────────────
// accounts.routes.ts — Cuenta corriente (tarea 5.9)
// Permiso "Cuentas corrientes" (accounts.manage): Administrador y Cajero por defecto.
// La lista de clientes la puede leer quien cobra (para el "a cuenta de…" del cobro).
// ──────────────────────────────────────────────
import { Router } from 'express';
import { accountsController } from './accounts.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/customers',                requirePermission('accounts.manage', 'sales.charge'), asyncHandler(accountsController.list));
router.post('/customers',               requirePermission('accounts.manage'), asyncHandler(accountsController.create));
router.patch('/customers/:id',          requirePermission('accounts.manage'), asyncHandler(accountsController.update));
router.delete('/customers/:id',         requirePermission('accounts.manage'), asyncHandler(accountsController.remove));
router.get('/customers/:id/statement',  requirePermission('accounts.manage'), asyncHandler(accountsController.statement));
router.post('/customers/:id/payments',  requirePermission('accounts.manage'), asyncHandler(accountsController.registerPayment));
router.delete('/payments/:id',          requirePermission('accounts.manage'), asyncHandler(accountsController.cancelPayment));

export { router as accountsRouter };
