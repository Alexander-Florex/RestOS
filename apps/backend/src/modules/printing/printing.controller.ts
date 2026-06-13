import type { Request, Response } from 'express';
import { z } from 'zod';
import { printingService } from './printing.service.js';
import { HttpError } from '../../lib/http-error.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });

const printOrderSchema = z.object({
  printerName:    z.string().min(1),
  restaurantName: z.string().default('RestOS'),
});

const printCashDirectSchema = z.object({
  printerName:    z.string().min(1),
  restaurantName: z.string().default('RestOS'),
  tableNumber:    z.coerce.number().int(),
  items: z.array(z.object({
    name:     z.string(),
    quantity: z.coerce.number().int(),
    price:    z.coerce.number(),
  })),
  total:         z.coerce.number(),
  amountPaid:    z.coerce.number(),
  paymentMethod: z.string(),
  notes:         z.string().optional().nullable(),
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

  // Ticket de caja — recibe los datos completos del frontend
  // Se usa DESPUÉS de cerrar la venta (los orders ya no existen en BD)
  async printCashDirect(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const opts = printCashDirectSchema.parse(req.body);
    await printingService.printCashTicketDirect({ restaurantId: req.user.restaurantId, ...opts });
    res.json({ ok: true, message: 'Ticket de caja enviado al agente' });
  },

  // Mantenido por compatibilidad (busca en BD — usar solo antes de cerrar)
  async printTableAccount(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const opts   = z.object({
      printerName: z.string().min(1),
      restaurantName: z.string().default('RestOS'),
      paymentMethod: z.string().optional(),
      amountPaid: z.coerce.number().optional(),
      notes: z.string().optional().nullable(),
    }).parse(req.body);
    await printingService.printTableOrders({ restaurantId: req.user.restaurantId, tableId: id, ...opts });
    res.json({ ok: true, message: 'Ticket de caja impreso' });
  },
};
