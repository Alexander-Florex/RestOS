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
  /** Color hex del estado, para gradientes y animaciones. */
  hex: string;
}> = {
  AVAILABLE: {
    border: 'border-emerald-400/25 hover:border-emerald-400/60',
    bg:     'bg-gradient-to-br from-emerald-500/[0.08] to-transparent',
    text:   'text-emerald-300',
    dot:    'bg-emerald-400',
    glow:   'hover:shadow-[0_12px_40px_-12px_rgba(52,211,153,0.45)]',
    hex:    '#34d399',
  },
  OCCUPIED: {
    border: 'border-brand-400/35 hover:border-brand-400/70',
    bg:     'bg-gradient-to-br from-brand-500/[0.16] to-brand-500/[0.02]',
    text:   'text-brand-300',
    dot:    'bg-brand-400',
    glow:   'shadow-[0_12px_40px_-16px_rgba(251,106,38,0.55)]',
    hex:    '#fb6a26',
  },
  BILL_REQUESTED: {
    border: 'border-amber-300/50 hover:border-amber-300/90',
    bg:     'bg-gradient-to-br from-amber-400/[0.2] to-amber-400/[0.03]',
    text:   'text-amber-200',
    dot:    'bg-amber-300 animate-pulse',
    glow:   'shadow-[0_12px_44px_-12px_rgba(252,211,77,0.6)]',
    hex:    '#fcd34d',
  },
  RESERVED: {
    border: 'border-violet-400/30 hover:border-violet-400/70',
    bg:     'bg-gradient-to-br from-violet-500/[0.12] to-transparent',
    text:   'text-violet-300',
    dot:    'bg-violet-400',
    glow:   'hover:shadow-[0_12px_40px_-12px_rgba(167,139,250,0.45)]',
    hex:    '#a78bfa',
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
