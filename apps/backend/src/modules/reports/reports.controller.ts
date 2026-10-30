// ──────────────────────────────────────────────
// reports.controller.ts — Handlers HTTP de reportes
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { reportsService } from './reports.service.js';
import { HttpError } from '../../lib/http-error.js';
import { dayParam, rangeParams } from '../../lib/date-query.js';
import { localDayKey, localDaysRange } from '../../lib/time.js';

const limitQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const dateQuery = z.object({
  date: dayParam,
});

export const reportsController = {
  async salesReport(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { from, to } = rangeParams.parse(req.query);
    const report = await reportsService.salesReport(req.user.restaurantId, { from, to });
    res.json(report);
  },

  async topItems(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const range = rangeParams.parse(req.query);
    const { limit } = limitQuery.parse(req.query);
    const items = await reportsService.topItems(req.user.restaurantId, range, limit ?? 10);
    res.json({ items });
  },

  async dailyTickets(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { date } = dateQuery.parse(req.query);
    const tickets = await reportsService.dailyTickets(req.user.restaurantId, localDaysRange(date));
    res.json({ tickets });
  },

  async salesCsv(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { from, to } = rangeParams.parse(req.query);
    const csv = await reportsService.salesCsv(req.user.restaurantId, { from, to });
    if (!csv) throw HttpError.notFound('No hay ventas en ese rango');

    const fromStr = localDayKey(from);
    const toStr = localDayKey(to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ventas-${fromStr}-${toStr}.csv"`);
    // BOM para que Excel detecte UTF-8 con acentos
    res.send('\uFEFF' + csv);
  },
};
