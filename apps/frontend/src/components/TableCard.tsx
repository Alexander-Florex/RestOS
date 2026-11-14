// ──────────────────────────────────────────────
// TableCard.tsx — Card individual de una mesa
// Muestra número, estado coloreado, comensales y tiempo ocupada en vivo.
// ──────────────────────────────────────────────
import { forwardRef } from 'react';
import { motion } from 'motion/react';
import { Users, Clock, Link2 } from 'lucide-react';
import type { Table } from '../lib/api';
import {
  TABLE_STATUS_LABEL,
  TABLE_STATUS_STYLE,
  elapsedSince,
} from '../lib/table-helpers';
import { useTick } from '../hooks/useTables';
import { cn } from '../lib/utils';
import { showsName, tableBadge, tablesLabel, useTableLabelMode } from '../lib/table-label';

interface TableCardProps {
  table: Table;
  /** Mesas unidas a esta (tarea 5.3) */
  partners?: Table[];
  onClick: () => void;
}

export const TableCard = forwardRef<HTMLButtonElement, TableCardProps>(function TableCard({ table, partners = [], onClick }, ref) {
  // Tick cada 30s para refrescar el tiempo
  useTick(30_000);
  useTableLabelMode();
  const byName = showsName(table);

  const style = TABLE_STATUS_STYLE[table.status];
  const elapsed = elapsedSince(table.openedAt);
  const busy = table.status === 'OCCUPIED' || table.status === 'BILL_REQUESTED';
  const billRequested = table.status === 'BILL_REQUESTED';

  return (
    <motion.button
      ref={ref}
      layout
      onClick={onClick}
      initial={{ opacity: 0, scale: 0.9, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      className={cn(
        'group relative flex aspect-square w-full flex-col justify-between overflow-hidden rounded-3xl border p-4 text-left backdrop-blur-sm',
        'transition-[border-color,box-shadow] duration-300',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        style.border,
        style.bg,
        style.glow
      )}
    >
      {/* Anillo pulsante cuando piden la cuenta */}
      {billRequested && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-3xl border-2 border-amber-300"
          animate={{ opacity: [0.7, 0, 0.7] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Brillo superior */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      <span
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-60"
        style={{ background: style.hex }}
      />

      {/* Estado */}
      <div className="relative flex items-center gap-1.5">
        <span className="relative flex h-2 w-2">
          {busy && <span className={cn('absolute inline-flex h-full w-full animate-ping-slow rounded-full', style.dot)} />}
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', style.dot)} />
        </span>
        <span className={cn('text-[10px] font-semibold uppercase tracking-[0.12em]', style.text)}>
          {TABLE_STATUS_LABEL[table.status]}
        </span>
      </div>

      {/* Nombre o número (según lo elegido en el restaurante) */}
      <div className="relative min-w-0">
        {byName ? (
          <p className={cn('font-display text-2xl font-bold leading-tight tracking-tight line-clamp-2 break-words', busy ? style.text : 'text-foreground')}>
            {tableBadge(table)}
          </p>
        ) : (
          <>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Mesa</p>
            <p className={cn('font-display text-5xl font-bold leading-none tabular-nums tracking-tight', busy ? style.text : 'text-foreground')}>
              {tableBadge(table)}
            </p>
          </>
        )}
      </div>

      {/* Unida con otras mesas */}
      {partners.length > 0 && (
        <span className="relative flex w-full min-w-0 items-center gap-1 truncate rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-200" title={`Unida con ${tablesLabel(partners)}`}>
          <Link2 className="h-3 w-3 shrink-0" />
          <span className="truncate">con {tablesLabel(partners)}</span>
        </span>
      )}

      {/* Footer: capacidad o comensales + tiempo */}
      <div className="relative flex w-full items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1 rounded-full bg-black/20 px-2 py-0.5">
          <Users className="h-3 w-3" />
          {busy ? (
            <span className="tabular-nums">{table.guestCount ?? '?'}/{table.capacity}</span>
          ) : (
            <span className="tabular-nums">{table.capacity}</span>
          )}
        </span>
        {elapsed && (
          <span className="flex items-center gap-1 rounded-full bg-black/20 px-2 py-0.5 tabular-nums">
            <Clock className="h-3 w-3" />
            {elapsed}
          </span>
        )}
      </div>
    </motion.button>
  );
});
