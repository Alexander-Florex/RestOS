// ──────────────────────────────────────────────
// TableOrderSheet.tsx — Todo lo que pidió la mesa, desde el celular del mozo
// Muestra cada pedido con su hora, en el orden en que se hicieron (con mesas unidas,
// los de todas), para no tener que preguntarle a Caja. Permite rehacer o pedir el
// cambio de un plato (tarea 5.8); los que necesitan autorización se ven como
// "esperando a caja".
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { RotateCcw, Replace, Clock } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from './ui/dialog';
import type { Order, OrderItem, Table } from '../lib/api';
import { formatMoney } from '../lib/format';
import { tableLabel as labelOf } from '../lib/table-label';
import { ItemModifiers } from './ItemModifiers';
import { ItemChangeDialog, type ChangeMode } from './ItemChangeDialog';
import { usePendingChanges } from './ChangeRequests';

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

export function TableOrderSheet({ open, onClose, orders, tables, tableLabel }: {
  open: boolean;
  onClose: () => void;
  orders: Order[];
  /** La mesa, o todas las del grupo si están unidas */
  tables: Table[];
  tableLabel: string;
}) {
  const [changing, setChanging] = useState<{ item: OrderItem; mode: ChangeMode; label: string } | null>(null);
  // Sin filtrar por mesa: con mesas unidas, el cambio puede ser de cualquiera de ellas
  const { changes: pending } = usePendingChanges(open ? undefined : null);
  const pendingByItem = new Map(pending.map(c => [c.orderItemId, c]));

  const sorted = useMemo(
    () => [...orders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id),
    [orders],
  );
  const active = sorted.flatMap(o => o.items).filter(i => i.status !== 'VOIDED');
  const totalCents = active.reduce((s, i) => s + Math.round(Number(i.price) * 100) * i.quantity, 0);
  const count = active.reduce((s, i) => s + i.quantity, 0);
  const labelFor = (order: Order) => {
    const table = tables.find(t => t.id === order.tableId);
    return table ? labelOf(table) : tableLabel;
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !changing && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pedido · {tableLabel}</DialogTitle>
          <DialogDescription>
            {count} {count === 1 ? 'plato' : 'platos'} · Total {formatMoney(totalCents / 100)}
          </DialogDescription>
        </DialogHeader>

        {sorted.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Esta mesa no tiene pedidos abiertos.</p>
        )}

        <div className="space-y-4">
          {sorted.map((order, index) => (
            <section key={order.id}>
              <p className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Pedido {index + 1} · {timeOf(order.createdAt)} hs</span>
                {tables.length > 1 && <span className="normal-case tracking-normal text-sky-300">{labelFor(order)}</span>}
              </p>
              {order.notes && <p className="mb-2 text-xs text-muted-foreground">{order.notes}</p>}
              <ul className="space-y-2">
                {order.items.map(item => {
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
                          <button onClick={() => setChanging({ item, mode: 'remake', label: labelFor(order) })}
                            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-amber-400/30 text-sm text-amber-200">
                            <RotateCcw className="h-4 w-4" /> Rehacer
                          </button>
                          <button onClick={() => setChanging({ item, mode: 'replace', label: labelFor(order) })}
                            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-brand-400/30 text-sm text-brand-200">
                            <Replace className="h-4 w-4" /> Cambiar
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {sorted.length > 0 && (
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-semibold">Total de la mesa</span>
            <span className="text-xl font-bold tabular-nums text-brand-400">{formatMoney(totalCents / 100)}</span>
          </div>
        )}

        <ItemChangeDialog item={changing?.item ?? null} mode={changing?.mode ?? 'replace'}
          tableLabel={changing?.label ?? tableLabel} onClose={() => setChanging(null)} />
      </DialogContent>
    </Dialog>
  );
}
