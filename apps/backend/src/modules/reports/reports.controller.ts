// ──────────────────────────────────────────────
// reports.controller.ts — Handlers HTTP de reportes
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { reportsService } from './reports.service.js';
import { HttpError } from '../../lib/http-error.js';

const rangeQuery = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
}).refine(d => d.from <= d.to, { message: '"from" debe ser anterior a "to"' });

const topItemsQuery = rangeQuery.and(z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
}));

export const reportsController = {
  async salesReport(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { from, to } = rangeQuery.parse(req.query);
    const report = await reportsService.salesReport(req.user.restaurantId, { from, to });
    res.json(report);
  },

  async topItems(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const parsed = topItemsQuery.parse(req.query);
    const items = await reportsService.topItems(
      req.user.restaurantId,
      { from: parsed.from, to: parsed.to },
      parsed.limit ?? 10
    );
    res.json({ items });
  },

  async salesCsv(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { from, to } = rangeQuery.parse(req.query);
    const csv = await reportsService.salesCsv(req.user.restaurantId, { from, to });
    if (!csv) throw HttpError.notFound('No hay ventas en ese rango');

    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ventas-${fromStr}-${toStr}.csv"`);
    // BOM para que Excel detecte UTF-8 con acentos
    res.send('\uFEFF' + csv);
  },
};
