import type { Request, Response } from 'express';
import { z } from 'zod';
import { printingService } from './printing.service.js';
import { HttpError } from '../../lib/http-error.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const kindParam = z.object({ kind: z.enum(['kitchen', 'cash']) });
const widthSchema = z.union([z.literal(58), z.literal(80)]);

function user(req: Request) {
  if (!req.user) throw HttpError.unauthorized();
  return req.user;
}

export const printingController = {
  // Comanda de cocina de un pedido de mesa
  async printOrder(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const job = await printingService.printOrder({ restaurantId: user(req).restaurantId, orderId: id });
    res.json({ ok: true, message: `Comanda #${id} enviada`, job });
  },

  // Comanda de cocina de un pedido para llevar
  async printTakeawayOrder(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const job = await printingService.printTakeawayKitchen({ restaurantId: user(req).restaurantId, takeawayId: id });
    res.json({ ok: true, message: `Comanda para llevar #${id} enviada`, job });
  },

  // Ticket de caja de una venta registrada — los datos salen de la base
  async printSale(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const job = await printingService.printSale({ restaurantId: user(req).restaurantId, saleId: id });
    res.json({ ok: true, message: 'Ticket de caja enviado', job });
  },

  // Ticket de caja de un pedido para llevar cobrado
  async printTakeawayReceipt(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const job = await printingService.printTakeawayReceipt({ restaurantId: user(req).restaurantId, takeawayId: id });
    res.json({ ok: true, message: 'Ticket de caja enviado', job });
  },

  async listJobs(req: Request, res: Response) {
    const { limit } = z.object({ limit: z.coerce.number().int().positive().max(200).default(50) }).parse(req.query);
    res.json(await printingService.listJobs(user(req).restaurantId, limit));
  },

  async reprint(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    res.json(await printingService.reprint(user(req).restaurantId, id));
  },

  // El agente confirma: { ok: true } o { ok: false, error }
  async markJob(req: Request, res: Response) {
    const { id } = idParam.parse(req.params);
    const body = z.object({ ok: z.boolean(), error: z.string().max(500).optional().nullable() }).parse(req.body);
    res.json(await printingService.markJob(user(req).restaurantId, id, body.ok, body.error));
  },

  async sample(req: Request, res: Response) {
    const { kind } = kindParam.parse(req.params);
    const { width } = z.object({ width: z.coerce.number().pipe(widthSchema).optional() }).parse(req.query);
    res.json(await printingService.sample(user(req).restaurantId, kind, width));
  },

  async printSample(req: Request, res: Response) {
    const { kind } = kindParam.parse(req.params);
    res.json(await printingService.printSample(user(req).restaurantId, kind));
  },

  async getSettings(req: Request, res: Response) {
    res.json(await printingService.getSettings(user(req).restaurantId));
  },

  async setSettings(req: Request, res: Response) {
    const u = user(req);
    const { paperWidth } = z.object({ paperWidth: widthSchema }).parse(req.body);
    res.json(await printingService.setSettings(u.restaurantId, paperWidth, u.userId ?? null));
  },
};
