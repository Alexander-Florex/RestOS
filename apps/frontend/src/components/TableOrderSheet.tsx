// ──────────────────────────────────────────────
// TableOrderSheet.tsx — Lo que ya pidió la mesa, desde el celular del mozo
// Permite rehacer o pedir el cambio de un plato (tarea 5.8). Los cambios que
// necesitan autorización se ven como "esperando a caja".
// ──────────────────────────────────────────────
import { useState } from 'react';
import { RotateCcw, Replace, Clock } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from './ui/dialog';
import type { Order, OrderItem } from '../lib/api';
import { formatMoney } from '../lib/format';
import { ItemModifiers } from './ItemModifiers';
import { ItemChangeDialog, type ChangeMode } from './ItemChangeDialog';
import { usePendingChanges } from './ChangeRequests';

export function TableOrderSheet({ open, onClose, orders, tableId, tableLabel }: {
  open: boolean;
  onClose: () => void;
  orders: Order[];
  tableId: number;
  tableLabel: string;
}) {
  const [changing, setChanging] = useState<{ item: OrderItem; mode: ChangeMode } | null>(null);
  const { changes: pending } = usePendingChanges(open ? tableId : null);
  const pendingByItem = new Map(pending.map(c => [c.orderItemId, c]));
  const items = orders.flatMap(o => o.items);
  const total = items.filter(i => i.status !== 'VOIDED').reduce((s, i) => s + Number(i.price) * i.quantity, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !changing && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pedido · {tableLabel}</DialogTitle>
          <DialogDescription>Total: {formatMoney(total)}. Tocá "Rehacer" o "Cambiar" en un plato.</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {items.map(item => {
            const waiting = pendingByItem.get(item.id);
            if (item.status === 'VOIDED') {
              return (
                <li key={item.id} className="rounded-xl border border-white/[0.05] p-3 text-sm text-muted-foreground">
                  <span className="line-through">{item.quantity}x {item.itemName}</span>
                  <p className="text-xs text-rose-300/80">{item.voidReason ?? 'Cambiado'} · no se cobra</p>
                </li>
              );
            }
            return (
              <li key={item.id} className="rounded-xl border border-white/[0.08] p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{item.quantity}x {item.itemName}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{formatMoney(Number(item.price) * item.quantity)}</span>
                </div>
                <ItemModifiers className="mt-1" modifiers={item.modifiers} notes={item.notes} />
                {waiting ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-300">
                    <Clock className="h-3.5 w-3.5" /> Cambio pedido · esperando a caja
                  </p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => setChanging({ item, mode: 'remake' })}
                      className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-400/30 text-sm text-amber-200">
                      <RotateCcw className="h-4 w-4" /> Rehacer
                    </button>
                    <button onClick={() => setChanging({ item, mode: 'replace' })}
                      className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-brand-400/30 text-sm text-brand-200">
                      <Replace className="h-4 w-4" /> Cambiar
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        <ItemChangeDialog item={changing?.item ?? null} mode={changing?.mode ?? 'replace'}
          tableLabel={tableLabel} onClose={() => setChanging(null)} />
      </DialogContent>
    </Dialog>
  );
}
