// ──────────────────────────────────────────────
// TableCard.tsx — Card individual de una mesa
// Muestra número, estado coloreado, comensales y tiempo ocupada en vivo.
// ──────────────────────────────────────────────
import { Users, Clock } from 'lucide-react';
import type { Table } from '../lib/api';
import {
  TABLE_STATUS_LABEL,
  TABLE_STATUS_STYLE,
  elapsedSince,
} from '../lib/table-helpers';
import { useTick } from '../hooks/useTables';
import { cn } from '../lib/utils';

interface TableCardProps {
  table: Table;
  onClick: () => void;
}

export function TableCard({ table, onClick }: TableCardProps) {
  // Tick cada 30s para refrescar el tiempo
  useTick(30_000);

  const style = TABLE_STATUS_STYLE[table.status];
  const elapsed = elapsedSince(table.openedAt);

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-center justify-between',
        'aspect-square w-full rounded-2xl border-2 p-4 text-left',
        'transition-all duration-200 hover:scale-[1.02] hover:shadow-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        style.border,
        style.bg,
        style.glow
      )}
    >
      {/* Estado: dot + label arriba a la derecha */}
      <div className="absolute right-3 top-3 flex items-center gap-1.5">
        <span className={cn('h-2 w-2 rounded-full', style.dot)} />
        <span className={cn('text-[10px] font-medium uppercase tracking-wider', style.text)}>
          {TABLE_STATUS_LABEL[table.status]}
        </span>
      </div>

      {/* Número de mesa centrado */}
      <div className="flex flex-1 items-center justify-center w-full">
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Mesa</p>
          <p className={cn('text-4xl font-bold tabular-nums', style.text)}>
            {String(table.number).padStart(2, '0')}
          </p>
        </div>
      </div>

      {/* Footer: capacidad o comensales + tiempo */}
      <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {table.status === 'OCCUPIED' || table.status === 'BILL_REQUESTED' ? (
            <span>{table.guestCount ?? '?'}/{table.capacity}</span>
          ) : (
            <span>{table.capacity}</span>
          )}
        </span>
        {elapsed && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {elapsed}
          </span>
        )}
      </div>
    </button>
  );
}
