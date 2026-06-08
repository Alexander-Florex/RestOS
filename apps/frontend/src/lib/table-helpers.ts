// ──────────────────────────────────────────────
// table-helpers.ts — Utilidades para presentar mesas
// ──────────────────────────────────────────────
import type { TableStatus } from './api';

export const TABLE_STATUS_LABEL: Record<TableStatus, string> = {
  AVAILABLE:      'Libre',
  OCCUPIED:       'Ocupada',
  BILL_REQUESTED: 'Cuenta pedida',
  RESERVED:       'Reservada',
};

/** Clases Tailwind por estado: borde, fondo y "dot" indicador. */
export const TABLE_STATUS_STYLE: Record<TableStatus, {
  border: string;
  bg: string;
  text: string;
  dot: string;
  glow: string;
}> = {
  AVAILABLE: {
    border: 'border-emerald-500/40 hover:border-emerald-500/70',
    bg:     'bg-emerald-500/5',
    text:   'text-emerald-400',
    dot:    'bg-emerald-500',
    glow:   'shadow-[0_0_24px_-8px_rgba(16,185,129,0.4)]',
  },
  OCCUPIED: {
    border: 'border-blue-500/40 hover:border-blue-500/70',
    bg:     'bg-blue-500/5',
    text:   'text-blue-400',
    dot:    'bg-blue-500',
    glow:   'shadow-[0_0_24px_-8px_rgba(59,130,246,0.4)]',
  },
  BILL_REQUESTED: {
    border: 'border-amber-500/50 hover:border-amber-500/80',
    bg:     'bg-amber-500/10',
    text:   'text-amber-400',
    dot:    'bg-amber-500 animate-pulse',
    glow:   'shadow-[0_0_24px_-8px_rgba(245,158,11,0.5)]',
  },
  RESERVED: {
    border: 'border-purple-500/40 hover:border-purple-500/70',
    bg:     'bg-purple-500/5',
    text:   'text-purple-400',
    dot:    'bg-purple-500',
    glow:   'shadow-[0_0_24px_-8px_rgba(168,85,247,0.4)]',
  },
};

/**
 * Devuelve el tiempo transcurrido desde openedAt en formato "1h 23m" o "5m".
 * Si openedAt es null, devuelve null.
 */
export function elapsedSince(iso: string | null): string | null {
  if (!iso) return null;
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}
