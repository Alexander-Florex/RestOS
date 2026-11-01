import { Router } from 'express';
import { printingController } from './printing.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/printers',           asyncHandler(printingController.listPrinters));
// Comandas: quien puede tomar pedidos
router.post('/orders/:id',        requirePermission('orders.create'), asyncHandler(printingController.printOrder));
router.post('/takeaway/:id',      requirePermission('orders.create'), asyncHandler(printingController.printTakeawayOrder));
// Ticket de caja de una venta ya registrada: se arma desde la base, no con datos del navegador
router.post('/sales/:id',         requirePermission('sales.charge'), asyncHandler(printingController.printSale));
// Ticket de caja de un pedido para llevar ya cobrado (también desde la base)
router.post('/takeaway/:id/receipt', requirePermission('sales.charge'), asyncHandler(printingController.printTakeawayReceipt));
// Ticket de caja buscando en BD (solo antes de cerrar)
router.post('/tables/:id/account', requirePermission('sales.charge'), asyncHandler(printingController.printTableAccount));

export { router as printingRouter };
