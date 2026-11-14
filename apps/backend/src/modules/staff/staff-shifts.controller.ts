// ──────────────────────────────────────────────
// staff-shifts.controller.ts — Horarios del personal (permiso staff.hours)
// ──────────────────────────────────────────────
import type { Request, Response } from 'express';
import { z } from 'zod';
import { staffShiftsService } from './staff-shifts.service.js';
import { HttpError } from '../../lib/http-error.js';
import { dayParam } from '../../lib/date-query.js';
import { addDays, startOfLocalDay, type DayKey } from '../../lib/time.js';

const idParam = z.object({ id: z.coerce.number().int().positive() });
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (usá HH:MM)');
const reason = z.string().trim().min(3, 'Escribí el motivo (por ejemplo: "se olvidó de marcar")').max(200);
const note = z.string().trim().max(200).optional().nullable();

/** Día + hora del local → instante. Una salida más temprano que la entrada es del día siguiente. */
function at(day: DayKey, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  return new Date(startOfLocalDay(day).getTime() + (h * 60 + m) * 60_000);
}
function range(day: DayKey, from: string, to: string | null) {
  const clockIn = at(day, from);
  if (to === null) return { clockIn, clockOut: null };
  let clockOut = at(day, to);
  if (clockOut <= clockIn) clockOut = at(addDays(day, 1), to); // pasó la medianoche
  return { clockIn, clockOut };
}

const createSchema = z.object({
  staffMemberId: z.coerce.number().int().positive(),
  day: dayParam,
  from: hhmm,
  to: hhmm.nullable(),
  note,
  reason,
});

const updateSchema = z.object({
  day: dayParam,
  from: hhmm,
  to: hhmm.nullable(),
  note,
  reason,
});

const removeSchema = z.object({ reason });
const weekQuery = z.object({ day: dayParam.optional() });

export const staffShiftsController = {
  async week(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { day } = weekQuery.parse(req.query);
    res.json(await staffShiftsService.week(req.user.restaurantId, day));
  },

  async weekCsv(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { day } = weekQuery.parse(req.query);
    const { csv, weekStart } = await staffShiftsService.weekCsv(req.user.restaurantId, day);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="horarios-semana-${weekStart}.csv"`);
    res.send(csv);
  },

  async clockIn(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const shift = await staffShiftsService.clockIn(req.user.restaurantId, id, req.user.userId);
    res.status(201).json({ shift });
  },

  async clockOut(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const shift = await staffShiftsService.clockOut(req.user.restaurantId, id);
    res.json({ shift });
  },

  async create(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const d = createSchema.parse(req.body);
    const shift = await staffShiftsService.create(req.user.restaurantId, {
      staffMemberId: d.staffMemberId, ...range(d.day, d.from, d.to),
      note: d.note || null, reason: d.reason, userId: req.user.userId,
    });
    res.status(201).json({ shift });
  },

  async update(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const d = updateSchema.parse(req.body);
    const shift = await staffShiftsService.update(req.user.restaurantId, id, {
      ...range(d.day, d.from, d.to), note: d.note || null, reason: d.reason,
    });
    res.json({ shift });
  },

  async remove(req: Request, res: Response) {
    if (!req.user) throw HttpError.unauthorized();
    const { id } = idParam.parse(req.params);
    const { reason } = removeSchema.parse(req.body ?? {});
    await staffShiftsService.remove(req.user.restaurantId, id, reason);
    res.status(204).send();
  },
};
