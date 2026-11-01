// ──────────────────────────────────────────────
// AddOrderDialog.tsx — Cargar un pedido a una mesa desde el panel
// (caja / encargado). Es la versión de escritorio de la toma de pedidos
// de la vista del mesero: mismos datos y mismo endpoint.
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Minus, Plus, Search, Send, X, AlertTriangle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { ordersApi, printingApi, ApiError, type MenuItem, type Table } from '../lib/api';
import { useMenu } from '../hooks/useMenu';
import { formatMoney } from '../lib/format';
import { cn } from '../lib/utils';

interface CartLine { item: MenuItem; quantity: number; notes: string }

interface AddOrderDialogProps {
  table: Table;
  open: boolean;
  onClose: () => void;
}

export function AddOrderDialog({ table, open, onClose }: AddOrderDialogProps) {
  const { items: menu, loading } = useMenu({ onlyEnabled: true });
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Map<number, CartLine>>(new Map());
  const [printTicket, setPrintTicket] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) { setCart(new Map()); setSearch(''); setSubmitting(false); }
  }, [open]);

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

  const lines = [...cart.values()];
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const totalCents = lines.reduce((s, l) => s + Math.round(Number(l.item.price) * 100) * l.quantity, 0);

  function adjust(item: MenuItem, delta: number) {
    setCart(prev => {
      const next = new Map(prev);
      const current = next.get(item.id);
      const quantity = (current?.quantity ?? 0) + delta;
      if (quantity <= 0) next.delete(item.id);
      else next.set(item.id, { item, quantity, notes: current?.notes ?? '' });
      return next;
    });
  }

  function setNotes(id: number, notes: string) {
    setCart(prev => {
      const next = new Map(prev);
      const current = next.get(id);
      if (current) next.set(id, { ...current, notes });
      return next;
    });
  }

  async function send() {
    if (lines.length === 0) return;
    setSubmitting(true);
    try {
      const { order } = await ordersApi.create({
        tableId: table.id,
        items: lines.map(l => ({ menuItemId: l.item.id, quantity: l.quantity, notes: l.notes.trim() || undefined })),
      });
      toast.success(`Pedido enviado a mesa ${table.number}`);
      if (printTicket) {
        try {
          await printingApi.printOrder(order.id);
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
    <Dialog open={open} onOpenChange={(v) => !v && !submitting && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agregar pedido · Mesa {table.number}</DialogTitle>
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
            const line = cart.get(item.id);
            const qty = line?.quantity ?? 0;
            return (
              <div key={item.id} className={cn(
                'rounded-xl border px-3 py-2',
                qty > 0 ? 'border-brand-500/40 bg-brand-500/5' : 'border-white/[0.07] bg-white/[0.02]',
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
                  {qty === 0 ? (
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => adjust(item, 1)} aria-label={`Agregar ${item.name}`}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => adjust(item, -1)} aria-label="Quitar uno">
                        {qty === 1 ? <X className="h-4 w-4 text-rose-400" /> : <Minus className="h-4 w-4" />}
                      </Button>
                      <span className="w-7 text-center text-sm font-semibold tabular-nums">{qty}</span>
                      <Button size="icon" className="h-8 w-8" onClick={() => adjust(item, 1)} aria-label="Sumar uno">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
                {qty > 0 && (
                  <input
                    value={line!.notes}
                    onChange={e => setNotes(item.id, e.target.value)}
                    placeholder="Aclaración para cocina (opcional)"
                    className="mt-2 flex h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                )}
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
          <Button onClick={send} disabled={submitting || count === 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar pedido{count > 0 && ` · ${count} · ${formatMoney(totalCents / 100)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
