// ──────────────────────────────────────────────
// AddOrderDialog.tsx — Cargar un pedido a una mesa desde el panel
// (caja / encargado). Es la versión de escritorio de la toma de pedidos
// de la vista del mesero: mismo carrito (plato + opciones + nota) y mismo endpoint.
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Minus, Plus, Search, Send, X, AlertTriangle, SlidersHorizontal, MessageSquare } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { ordersApi, printingApi, ApiError, type MenuItem, type Table } from '../lib/api';
import { useMenu } from '../hooks/useMenu';
import { useOrderCart, type CartLine } from '../hooks/useOrderCart';
import { hasOptions, needsChoice, selectionModifiers } from '../lib/modifiers';
import { formatMoney } from '../lib/format';
import { cn } from '../lib/utils';
import { DishOptionsDialog, type DishChoice } from './DishOptionsDialog';
import { ItemModifiers } from './ItemModifiers';
import { submitOrder } from '../lib/order-queue';
import { tableLabel } from '../lib/table-label';

interface AddOrderDialogProps {
  table: Table;
  open: boolean;
  onClose: () => void;
}

export function AddOrderDialog({ table, open, onClose }: AddOrderDialogProps) {
  const { items: menu, loading } = useMenu({ onlyEnabled: true });
  const cart = useOrderCart();
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [printTicket, setPrintTicket] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [customizing, setCustomizing] = useState<{ item: MenuItem; line?: CartLine } | null>(null);

  const { clear } = cart;
  useEffect(() => {
    if (!open) { clear(); setSearch(''); setSubmitting(false); setCustomizing(null); }
  }, [open, clear]);

  const categories = useMemo(
    () => [...new Set(menu.map(m => m.category).filter(Boolean))].sort(),
    [menu],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menu.filter(m =>
      m.stock !== 'OUT_OF_STOCK' &&
      (q ? m.name.toLowerCase().includes(q) : !category || m.category === category),
    );
  }, [menu, category, search]);

  function quickAdd(item: MenuItem) {
    if (needsChoice(item)) setCustomizing({ item });
    else cart.add(item);
  }

  function confirmCustomize(choice: DishChoice) {
    if (!customizing) return;
    if (customizing.line) cart.replace(customizing.line.key, customizing.item, choice);
    else cart.add(customizing.item, choice);
    setCustomizing(null);
  }

  async function send() {
    if (cart.count === 0) return;
    setSubmitting(true);
    try {
      const res = await submitOrder('table', { tableId: table.id, items: cart.toRequestItems() },
        { label: `${tableLabel(table)} · ${cart.count} ${cart.count === 1 ? 'ítem' : 'ítems'}`, print: printTicket });
      if (res.status === 'queued') {
        toast.warning('Sin conexión: el pedido quedó guardado en este dispositivo', { description: 'Se envía solo cuando vuelva la conexión. No hace falta cargarlo de nuevo.', duration: 8000 });
        onClose();
        return;
      }
      toast.success(`Pedido enviado a ${tableLabel(table)}`);
      if (printTicket) {
        try {
          await printingApi.printOrder(res.order.id);
        } catch (err) {
          toast.error(
            `El pedido quedó cargado, pero la comanda no se imprimió: ${err instanceof ApiError ? err.message : 'revisá la impresora'}`,
            { duration: 10_000 },
          );
        }
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al enviar el pedido');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && !customizing && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agregar pedido · {tableLabel(table)}</DialogTitle>
          <DialogDescription>Elegí los platos. Se suma como un pedido nuevo de la mesa.</DialogDescription>
        </DialogHeader>

        {/* Búsqueda y categorías */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar plato..."
              className="flex h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {!search && (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {['', ...categories].map(c => (
                <button key={c || 'all'} onClick={() => setCategory(c)}
                  className={cn(
                    'whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    category === c ? 'bg-brand-500 text-white' : 'bg-white/[0.05] text-muted-foreground hover:text-foreground',
                  )}>
                  {c || 'Todos'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Platos */}
        <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando carta...
            </div>
          ) : visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No hay platos disponibles</p>
          ) : visible.map(item => {
            const lines = cart.linesOf(item.id);
            const count = lines.reduce((s, l) => s + l.quantity, 0);
            return (
              <div key={item.id} className={cn(
                'rounded-xl border px-3 py-2',
                count > 0 ? 'border-brand-500/40 bg-brand-500/5' : 'border-white/[0.07] bg-white/[0.02]',
              )}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="tabular-nums text-brand-300">{formatMoney(item.price)}</span>
                      {item.stock === 'LOW_STOCK' && (
                        <span className="flex items-center gap-1 text-amber-300"><AlertTriangle className="h-3 w-3" /> Stock bajo</span>
                      )}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5 text-xs"
                    onClick={() => setCustomizing({ item })}>
                    {hasOptions(item) ? <SlidersHorizontal className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                    {hasOptions(item) ? 'Opciones' : 'Nota'}
                  </Button>
                  <Button size="icon" className="h-8 w-8" onClick={() => quickAdd(item)} aria-label={`Agregar ${item.name}`}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Líneas cargadas de este plato */}
                {lines.map(line => (
                  <div key={line.key} className="mt-2 flex items-center gap-2 border-t border-white/[0.06] pt-2">
                    <button className="min-w-0 flex-1 text-left" onClick={() => setCustomizing({ item, line })} title="Editar opciones y nota">
                      <ItemModifiers modifiers={selectionModifiers(item, line.optionIds)} notes={line.notes} />
                      {line.optionIds.length === 0 && !line.notes && (
                        <span className="text-xs text-muted-foreground">Sin cambios</span>
                      )}
                    </button>
                    <span className="text-xs tabular-nums text-muted-foreground">{formatMoney(line.unitPrice)}</span>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => cart.adjust(line.key, -1)} aria-label="Quitar uno">
                        {line.quantity === 1 ? <X className="h-3.5 w-3.5 text-rose-400" /> : <Minus className="h-3.5 w-3.5" />}
                      </Button>
                      <span className="w-6 text-center text-sm font-semibold tabular-nums">{line.quantity}</span>
                      <Button size="icon" className="h-7 w-7" onClick={() => cart.adjust(line.key, 1)} aria-label="Sumar uno">
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={printTicket} onChange={e => setPrintTicket(e.target.checked)} className="h-4 w-4 accent-orange-500" />
          Imprimir la comanda en cocina
        </label>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button onClick={send} disabled={submitting || cart.count === 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar pedido{cart.count > 0 && ` · ${cart.count} · ${formatMoney(cart.total)}`}
          </Button>
        </DialogFooter>

        {/* Selector anidado: va dentro del contenido para que el diálogo padre no se cierre */}
        <DishOptionsDialog
          item={customizing?.item ?? null}
          initial={customizing?.line && {
            optionIds: customizing.line.optionIds, notes: customizing.line.notes, quantity: customizing.line.quantity,
          }}
          confirmLabel={customizing?.line ? 'Guardar' : 'Agregar'}
          onClose={() => setCustomizing(null)}
          onConfirm={confirmCustomize}
        />
      </DialogContent>
    </Dialog>
  );
}
