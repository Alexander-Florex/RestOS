// ──────────────────────────────────────────────
// StockMovementsDialog.tsx — Movimientos de stock de un insumo (tarea 3.2)
// El stock es la suma de estos movimientos.
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from './ui/dialog';
import { inventoryApi, type InventoryItem, type StockMovement, type StockMovementType } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { cn } from '../lib/utils';

export const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  PURCHASE: 'Compra',
  SALE: 'Venta',
  PRODUCTION: 'Producción',
  CONSUMPTION: 'Consumo',
  WASTE: 'Merma',
  ADJUSTMENT: 'Ajuste',
  COUNT: 'Conteo',
};

/** Cantidad legible: hasta 3 decimales, con signo. */
export function fmtQty(n: number, signed = false): string {
  const v = Math.round(n * 1000) / 1000;
  const s = v.toLocaleString('es-AR', { maximumFractionDigits: 3 });
  return signed && v > 0 ? `+${s}` : s;
}

export function StockMovementsDialog({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const [rows, setRows] = useState<StockMovement[] | null>(null);

  useEffect(() => {
    if (!item) return;
    setRows(null);
    inventoryApi.movements(item.id).then(r => setRows(r.movements)).catch(() => setRows([]));
  }, [item]);

  return (
    <Dialog open={item !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Movimientos · {item?.name}</DialogTitle>
          <DialogDescription>
            En {item?.unit}. El stock es la suma de estos movimientos; el más nuevo arriba.
          </DialogDescription>
        </DialogHeader>
        {rows === null ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sin movimientos registrados</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto text-sm">
            {rows.map(m => (
              <li key={m.id} className="flex items-start gap-3 py-2">
                <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDateTime(m.createdAt)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{MOVEMENT_LABEL[m.type]}</span>
                  {m.reference && <span className="text-xs text-muted-foreground"> · {m.reference}</span>}
                  {m.reason && <span className="block text-xs text-muted-foreground">{m.reason}</span>}
                  {m.userName && <span className="block text-[11px] text-muted-foreground/70">{m.userName}</span>}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className={cn('font-semibold', m.quantity > 0 ? 'text-emerald-300' : 'text-rose-300')}>
                    {fmtQty(m.quantity, true)}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">queda {fmtQty(m.balanceAfter)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
