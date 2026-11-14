// ──────────────────────────────────────────────
// analytics.controller.ts — Reportes de la fase 4 (permiso reports.view)
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { analyticsService } from './analytics.service.js';
import { HttpError } from '../../lib/http-error.js';
import { dayParam, rangeParams } from '../../lib/date-query.js';
import { localDayKey } from '../../lib/time.js';

const dayQuery = z.object({ day: dayParam.optional() });

export const analyticsController = {
  async profitability(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { from, to } = rangeParams.parse(req.query);
    res.json(await analyticsService.profitability(req.user.restaurantId, from, to));
  },
  async theoreticalVsReal(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { from, to } = rangeParams.parse(req.query);
    res.json(await analyticsService.theoreticalVsReal(req.user.restaurantId, from, to));
  },
  async dailyClose(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { day } = dayQuery.parse(req.query);
    res.json(await analyticsService.dailyClose(req.user.restaurantId, day ?? localDayKey(new Date())));
  },
  async dailyCloseCsv(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { day } = dayQuery.parse(req.query);
    const d = day ?? localDayKey(new Date());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cierre-${d}.csv"`);
    res.send(await analyticsService.dailyCloseCsv(req.user.restaurantId, d));
  },
  async owner(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    res.json(await analyticsService.owner(req.user.restaurantId));
  },
};
