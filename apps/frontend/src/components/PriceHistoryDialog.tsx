// ──────────────────────────────────────────────
// PriceHistoryDialog.tsx — Historial de costos de un insumo (tarea 2.5)
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from './ui/dialog';
import { inventoryApi, type InventoryItem, type PriceHistoryEntry } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { cn } from '../lib/utils';

const SOURCE_LABEL: Record<PriceHistoryEntry['source'], string> = {
  MANUAL: 'A mano', PURCHASE: 'Compra', IMPORT: 'Importación',
};

export function PriceHistoryDialog({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const [rows, setRows] = useState<PriceHistoryEntry[] | null>(null);

  useEffect(() => {
    if (!item) return;
    setRows(null);
    inventoryApi.priceHistory(item.id).then(r => setRows(r.history)).catch(() => setRows([]));
  }, [item]);

  return (
    <Dialog open={item !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Historial de precios · {item?.name}</DialogTitle>
          <DialogDescription>Costo por {item?.unit}. Cada cambio queda registrado con su origen.</DialogDescription>
        </DialogHeader>
        {rows === null ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Sin cambios de precio registrados</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto text-sm">
            {rows.map(r => {
              const prev = r.previousCost !== null ? Number(r.previousCost) : null;
              const cur = Number(r.costPerUnit);
              const pct = prev ? ((cur - prev) / prev) * 100 : null;
              return (
                <li key={r.id} className="flex items-center gap-3 py-2">
                  <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                  <span className="flex-1">
                    <span className="font-semibold tabular-nums">{formatMoney(cur)}</span>
                    {prev !== null && <span className="text-xs text-muted-foreground"> (antes {formatMoney(prev)})</span>}
                    {r.purchaseQty && (
                      <span className="block text-xs text-muted-foreground">
                        {r.purchaseQty} {r.purchaseUnit} a {formatMoney(r.purchasePrice)}
                      </span>
                    )}
                  </span>
                  {pct !== null && Number.isFinite(pct) && (
                    <span className={cn('flex items-center gap-0.5 text-xs tabular-nums', pct > 0 ? 'text-rose-300' : 'text-emerald-300')}>
                      {pct > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {pct > 0 ? '+' : ''}{pct.toFixed(1)}%
                    </span>
                  )}
                  <span className="shrink-0 text-right text-xs text-muted-foreground">
                    {SOURCE_LABEL[r.source]}<br />{r.userName ?? ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
