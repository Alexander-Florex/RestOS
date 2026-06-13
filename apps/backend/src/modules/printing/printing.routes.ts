import { Router } from 'express';
import { printingController } from './printing.controller.js';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';

const router = Router();
router.use(authenticate);

router.get('/printers',           asyncHandler(printingController.listPrinters));
router.post('/orders/:id',        asyncHandler(printingController.printOrder));
router.post('/takeaway/:id',      asyncHandler(printingController.printTakeawayOrder));
// Ticket de caja con datos del frontend (después de cerrar venta)
router.post('/cash-direct',       asyncHandler(printingController.printCashDirect));
// Ticket de caja buscando en BD (solo antes de cerrar)
router.post('/tables/:id/account', requireRole('ADMIN', 'STAFF'), asyncHandler(printingController.printTableAccount));

export { router as printingRouter };
