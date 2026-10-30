import type { Request, Response } from 'express';
import { z } from 'zod';
import { printingService } from './printing.service.js';
import { HttpError } from '../../lib/http-error.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

// printerName es opcional: imprime el agente local, que ya sabe cuál es su impresora.
const printOrderSchema = z.object({
  printerName:    z.string().optional(),
  restaurantName: z.string().default('RestOS'),
});

export const printingController = {
  async listPrinters(_req: Request, res: Response) {
    res.json(await printingService.listPrinters());
  },

  // Ticket de cocina — desde el ID del pedido
  async printOrder(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const opts   = printOrderSchema.parse(req.body);
    await printingService.printOrder({ restaurantId: req.user.restaurantId, orderId: id, ...opts });
    res.json({ ok: true, message: `Comanda #${id} enviada` });
  },

  // Ticket de cocina para TakeawayOrder
  async printTakeawayOrder(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const opts   = printOrderSchema.parse(req.body);
    await printingService.printTakeawayKitchen({ restaurantId: req.user.restaurantId, takeawayId: id, ...opts });
    res.json({ ok: true, message: `Comanda para llevar #${id} enviada` });
  },

  // Ticket de caja de una venta registrada — los datos salen de la base
  async printSale(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await printingService.printSale({ restaurantId: req.user.restaurantId, saleId: id });
    res.json({ ok: true, message: 'Ticket de caja enviado al agente' });
  },

  // Ticket de caja de un pedido para llevar cobrado — los datos salen de la base
  async printTakeawayReceipt(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    await printingService.printTakeawayReceipt({ restaurantId: req.user.restaurantId, takeawayId: id });
    res.json({ ok: true, message: 'Ticket de caja enviado al agente' });
  },

  // Mantenido por compatibilidad (busca en BD — usar solo antes de cerrar)
  async printTableAccount(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const opts   = z.object({
      printerName: z.string().optional(),
      restaurantName: z.string().default('RestOS'),
      paymentMethod: z.string().optional(),
      amountPaid: z.coerce.number().optional(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);
    await printingService.printTableOrders({ restaurantId: req.user.restaurantId, tableId: id, ...opts });
    res.json({ ok: true, message: 'Ticket de caja impreso' });
  },
};
