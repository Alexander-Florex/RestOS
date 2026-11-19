import { Router } from 'express';
import { printingController } from './printing.controller.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

// Comandas: quien puede tomar pedidos
router.post('/orders/:id',           requirePermission('orders.create'), asyncHandler(printingController.printOrder));
router.post('/takeaway/:id',         requirePermission('orders.create'), asyncHandler(printingController.printTakeawayOrder));
// Tickets de caja de ventas ya registradas: se arman desde la base, no con datos del navegador
router.post('/sales/:id',            requirePermission('sales.charge'), asyncHandler(printingController.printSale));
router.post('/takeaway/:id/receipt', requirePermission('sales.charge'), asyncHandler(printingController.printTakeawayReceipt));

// Comandera: lo que se mandó a imprimir, cómo se ve y si salió
router.get('/jobs',                  requirePermission('sales.charge'), asyncHandler(printingController.listJobs));
router.post('/jobs/:id/reprint',     requirePermission('sales.charge'), asyncHandler(printingController.reprint));
router.post('/jobs/:id/retry',       requirePermission('sales.charge'), asyncHandler(printingController.retry));
router.post('/jobs/:id/discard',     requirePermission('sales.charge'), asyncHandler(printingController.discard));
router.get('/status',                requirePermission('sales.charge'), asyncHandler(printingController.status));
router.get('/sample/:kind',          requirePermission('sales.charge'), asyncHandler(printingController.sample));
router.post('/sample/:kind',         requirePermission('sales.charge'), asyncHandler(printingController.printSample));
router.get('/settings',              requirePermission('sales.charge'), asyncHandler(printingController.getSettings));
router.put('/settings',              requirePermission('tables.manage'), asyncHandler(printingController.setSettings));
router.get('/printers',              requirePermission('tables.manage'), asyncHandler(printingController.printers));

export { router as printingRouter };
