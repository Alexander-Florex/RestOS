// ──────────────────────────────────────────────
// reservation-helpers.ts — Labels y estilos por estado
// ──────────────────────────────────────────────
import type { ReservationStatus } from './api';

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  PENDING:   'Pendiente',
  CONFIRMED: 'Confirmada',
  SEATED:    'En mesa',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  NO_SHOW:   'No vino',
};

export const RESERVATION_STATUS_STYLE: Record<ReservationStatus, {
  text: string; bg: string; border: string; dot: string;
}> = {
  PENDING:   { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   dot: 'bg-amber-500' },
  CONFIRMED: { text: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    dot: 'bg-blue-500' },
  SEATED:    { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-500' },
  COMPLETED: { text: 'text-muted-foreground', bg: 'bg-secondary/30', border: 'border-border', dot: 'bg-muted-foreground' },
  CANCELLED: { text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    dot: 'bg-rose-500' },
  NO_SHOW:   { text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    dot: 'bg-rose-500' },
};

/** Devuelve "HH:MM" desde un ISO. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

/** Devuelve string YYYY-MM-DD en zona local (no UTC). */
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Convierte un input "YYYY-MM-DDTHH:mm" a Date (zona local). */
export function parseLocalDateTime(s: string): Date {
  return new Date(s);
}

/** Devuelve el ISO formateado para un <input type="datetime-local"> (zona local). */
export function toDateTimeLocalInput(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

/** Devuelve cuántos minutos faltan (negativo si ya pasó). */
export function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}
