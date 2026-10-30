// ──────────────────────────────────────────────
// date-query.ts — Fechas recibidas por query string
//
// Se aceptan días "YYYY-MM-DD" (interpretados en la hora del local) o, por
// compatibilidad, instantes ISO completos.
// ──────────────────────────────────────────────
import { z } from 'zod';
import { isDayKey, localDayKey, localDaysRange, type DayKey } from './time.js';

const dayOrInstant = z.string().trim().refine(
  (v) => isDayKey(v) || (v.length > 10 && !Number.isNaN(Date.parse(v))),
  { message: 'Fecha inválida (usá YYYY-MM-DD)' },
);

/** Un día: "YYYY-MM-DD" tal cual, o el día local del instante recibido. */
export const dayParam = dayOrInstant.transform((v): DayKey => (isDayKey(v) ? v : localDayKey(new Date(v))));

/** Rango: un día "desde" empieza a las 00:00 y un día "hasta" termina a las 23:59:59.999 locales. */
export const rangeParams = z.object({ from: dayOrInstant, to: dayOrInstant })
  .transform(({ from, to }) => ({
    from: isDayKey(from) ? localDaysRange(from).from : new Date(from),
    to: isDayKey(to) ? localDaysRange(to).to : new Date(to),
  }))
  .refine((r) => r.from <= r.to, { message: '"from" debe ser anterior a "to"' });
