// ──────────────────────────────────────────────
// time.ts — Días y horas en la zona del local
//
// Las fechas se guardan en UTC. Todo lo que sea "qué día es" (reportes,
// estadísticas del día, CSV, tickets) se calcula acá, en la hora de Buenos
// Aires, sin depender de la zona horaria del servidor ni del navegador.
// No usar setHours ni toISOString().slice(0, 10) para agrupar por día.
// ──────────────────────────────────────────────

export const APP_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/** Día calendario como texto "YYYY-MM-DD". */
export type DayKey = string;

const DAY_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function localParts(instant: Date) {
  const parts: Record<string, string> = {};
  for (const p of partsFormatter.formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: parts.year, month: parts.month, day: parts.day,
    hour: parts.hour, minute: parts.minute, second: parts.second,
  };
}

/** Diferencia (ms) entre la hora local y UTC en ese instante. Ej.: -3 h en Argentina. */
function offsetMs(instant: Date): number {
  const p = localParts(instant);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - wholeSeconds;
}

/** ¿Es un día válido "YYYY-MM-DD"? */
export function isDayKey(value: string): boolean {
  const m = DAY_KEY_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Día local (en el local) al que pertenece un instante. */
export function localDayKey(instant: Date): DayKey {
  const p = localParts(instant);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Fecha y hora local "YYYY-MM-DD HH:mm:ss" (para CSV y textos). */
export function formatLocalDateTime(instant: Date): string {
  const p = localParts(instant);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Suma días a un día calendario. */
export function addDays(day: DayKey, days: number): DayKey {
  const m = DAY_KEY_RE.exec(day);
  if (!m) throw new Error(`Día inválido: ${day}`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + days));
  return d.toISOString().slice(0, 10); // en UTC puro esto es seguro: no hay hora
}

/** Instante en que empieza un día local (00:00 en Buenos Aires). */
export function startOfLocalDay(day: DayKey): Date {
  const m = DAY_KEY_RE.exec(day);
  if (!m) throw new Error(`Día inválido: ${day}`);
  const midnightUtc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  // Se corrige dos veces por si la zona cambia de horario justo ese día
  let t = midnightUtc - offsetMs(new Date(midnightUtc));
  const again = midnightUtc - offsetMs(new Date(t));
  if (again !== t) t = again;
  return new Date(t);
}

/** Rango [desde, hasta] de días locales completos, inclusive. */
export function localDaysRange(fromDay: DayKey, toDay: DayKey = fromDay): { from: Date; to: Date } {
  return {
    from: startOfLocalDay(fromDay),
    to: new Date(startOfLocalDay(addDays(toDay, 1)).getTime() - 1),
  };
}

/** Lunes de la semana a la que pertenece un día (semanas de lunes a domingo). */
export function weekStartOf(day: DayKey): DayKey {
  const m = DAY_KEY_RE.exec(day);
  if (!m) throw new Error(`Día inválido: ${day}`);
  const dow = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(); // 0 = domingo
  return addDays(day, -((dow + 6) % 7));
}
