// ──────────────────────────────────────────────
// ItemChangeDialog.tsx — Rehacer o cambiar un plato ya pedido (tarea 5.8)
//
// Regla del cliente: se cobra solo lo que se consume. El plato cambiado no
// se cobra y, si ya estaba hecho, queda como pérdida. Siempre con motivo y de
// quién fue el error. El mozo pide el cambio; Caja o Administrador lo autorizan
// (o lo hacen directo). Rehacer lo puede hacer quien toma pedidos.
// Mobile-first: lo usa el mozo desde el celular.
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Minus, Plus, RotateCcw, Replace, Search, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import {
  ordersApi, ApiError, type ItemChangeFault, type MenuItem, type OrderItem,
} from '../lib/api';
import { useMenu } from '../hooks/useMenu';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../lib/format';
import { selectionModifiers, unitPrice } from '../lib/modifiers';
import { cn } from '../lib/utils';
import { DishOptionsDialog, type DishChoice } from './DishOptionsDialog';
import { ItemModifiers } from './ItemModifiers';

export type ChangeMode = 'remake' | 'replace';

const FAULTS: Array<{ value: ItemChangeFault; label: string }> = [
  { value: 'KITCHEN', label: 'Error de cocina' },
  { value: 'WAITER', label: 'Error del mozo' },
  { value: 'CUSTOMER', label: 'El cliente cambió de opinión' },
  { value: 'OTHER', label: 'Otro' },
];

const QUICK: Record<ChangeMode, string[]> = {
  remake: ['Salió frío', 'No respetó la indicación', 'Término equivocado', 'Se cayó'],
  replace: ['El cliente se arrepintió', 'No le gustó', 'Se tomó mal el pedido', 'Alergia / ingrediente'],
};

interface Props {
  item: OrderItem | null;
  tableNumber: number;
  mode: ChangeMode;
  onClose: () => void;
}

export function ItemChangeDialog({ item, tableNumber, mode, onClose }: Props) {
  const { can } = useAuth();
  const canApprove = can('orders.change.approve');
  const { items: menu } = useMenu({ onlyEnabled: true });
  const [quantity, setQuantity] = useState(1);
  const [fault, setFault] = useState<ItemChangeFault | null>(null);
  const [wasPrepared, setWasPrepared] = useState(false);
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [replacement, setReplacement] = useState<{ item: MenuItem; choice: DishChoice } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setQuantity(1); setFault(mode === 'remake' ? 'KITCHEN' : null); setWasPrepared(false);
    setReason(''); setSearch(''); setReplacement(null); setPicking(null); setSaving(false);
  }, [item, mode]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menu.filter(m => m.stock !== 'OUT_OF_STOCK' && (!q || m.name.toLowerCase().includes(q))).slice(0, 30);
  }, [menu, search]);

  if (!item) return null;
  const isReplace = mode === 'replace';
  const original = Number(item.price) * quantity;
  const newTotal = replacement ? unitPrice(replacement.item, replacement.choice.optionIds) * quantity : 0;
  const valid = reason.trim().length >= 3 && fault !== null && (!isReplace || replacement !== null);

  async function submit() {
    if (!item || !valid) return;
    setSaving(true);
    try {
      if (!isReplace) {
        await ordersApi.remakeItem(item.id, { quantity, reason: reason.trim(), fault });
        toast.success(`Se mandó a rehacer: ${quantity}x ${item.itemName}`, { description: 'Salió el ticket a cocina' });
      } else {
        const { change } = await ordersApi.replaceItem(item.id, {
          quantity, reason: reason.trim(), fault, wasPrepared,
          replacement: {
            menuItemId: replacement!.item.id,
            optionIds: replacement!.choice.optionIds,
            notes: replacement!.choice.notes || null,
          },
        });
        if (change.status === 'PENDING') {
          toast.success('Pedido de cambio enviado a caja', { description: 'Te avisamos cuando lo autoricen' });
        } else {
          toast.success(`Cambiado: ${item.itemName} → ${replacement!.item.name}`, { description: 'Salió el ticket a cocina' });
        }
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo hacer el cambio');
      setSaving(false);
    }
  }

  return (
    <Dialog open={item !== null} onOpenChange={(v) => !v && !saving && !picking && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isReplace ? <Replace className="h-5 w-5 text-brand-400" /> : <RotateCcw className="h-5 w-5 text-amber-400" />}
            {isReplace ? 'Cambiar plato' : 'Rehacer plato'} · Mesa {tableNumber}
          </DialogTitle>
          <DialogDescription>
            {isReplace
              ? 'El plato que se cambia no se cobra. Si ya estaba hecho, queda como pérdida.'
              : 'Se cobra una sola vez. Lo que se tiró queda como pérdida.'}
            {isReplace && !canApprove && ' Lo tiene que autorizar caja.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Plato original */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
            <p className="text-sm font-medium">{item.quantity}x {item.itemName}</p>
            <ItemModifiers className="mt-1" modifiers={item.modifiers} notes={item.notes} />
            {item.quantity > 1 && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">¿Cuántos?</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setQuantity(q => Math.max(1, q - 1))} aria-label="Menos"
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.06]"><Minus className="h-4 w-4" /></button>
                  <span className="w-8 text-center font-semibold tabular-nums">{quantity}</span>
                  <button type="button" onClick={() => setQuantity(q => Math.min(item.quantity, q + 1))} aria-label="Más"
                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.06]"><Plus className="h-4 w-4" /></button>
                </div>
              </div>
            )}
          </div>

          {/* Reemplazo */}
          {isReplace && (
            <section>
              <p className="mb-2 text-sm font-semibold">¿Por cuál lo cambia?</p>
              {replacement ? (
                <div className="flex items-start justify-between gap-2 rounded-xl border border-brand-400/40 bg-brand-500/10 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{quantity}x {replacement.item.name}</p>
                    <ItemModifiers className="mt-1" modifiers={selectionModifiers(replacement.item, replacement.choice.optionIds)} notes={replacement.choice.notes} />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatMoney(original)} → {formatMoney(newTotal)}
                      {newTotal !== original && ` (${newTotal > original ? '+' : '−'}${formatMoney(Math.abs(newTotal - original))})`}
                    </p>
                  </div>
                  <button type="button" onClick={() => setReplacement(null)} aria-label="Elegir otro"
                    className="rounded-lg p-1 text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
                </div>
              ) : (
                <>
                  <div className="relative mb-2">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar plato..."
                      className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
                  </div>
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {results.map(m => (
                      <button key={m.id} type="button" onClick={() => setPicking(m)}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-white/[0.05]">
                        <span className="truncate">{m.name}</span>
                        <span className="shrink-0 tabular-nums text-brand-300">{formatMoney(m.price)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {/* De quién fue el error */}
          <section>
            <p className="mb-2 text-sm font-semibold">¿De quién fue el error?</p>
            <div className="flex flex-wrap gap-2">
              {FAULTS.map(f => (
                <button key={f.value} type="button" onClick={() => setFault(f.value)} aria-pressed={fault === f.value}
                  className={cn('min-h-10 rounded-xl border px-3 text-sm transition-colors',
                    fault === f.value ? 'border-brand-400/60 bg-brand-500/15' : 'border-white/[0.08] text-muted-foreground')}>
                  {f.label}
                </button>
              ))}
            </div>
          </section>

          {isReplace && (
            <label className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.08] p-3 text-sm">
              <span>
                <span className="font-semibold">¿Ya estaba hecho?</span>
                <span className="block text-xs text-muted-foreground">Si salió de cocina, se registra como pérdida</span>
              </span>
              <input type="checkbox" checked={wasPrepared} onChange={e => setWasPrepared(e.target.checked)}
                className="h-5 w-5 accent-orange-500" />
            </label>
          )}

          {/* Motivo (obligatorio) */}
          <section>
            <p className="mb-2 text-sm font-semibold">Motivo <span className="font-normal text-muted-foreground">(obligatorio)</span></p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK[mode].map(r => (
                <button key={r} type="button" onClick={() => setReason(r)}
                  className={cn('rounded-full border px-2.5 py-1 text-xs',
                    reason === r ? 'border-brand-400/50 bg-brand-500/10' : 'border-border text-muted-foreground')}>
                  {r}
                </button>
              ))}
            </div>
            <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={500}
              aria-label="Motivo" placeholder="Contá qué pasó"
              className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </section>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Volver</Button>
          <Button onClick={submit} disabled={saving || !valid} className="min-h-11">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {!isReplace ? 'Mandar a rehacer' : canApprove ? 'Hacer el cambio' : 'Pedir autorización'}
          </Button>
        </DialogFooter>

        {/* Opciones y nota del plato nuevo (anidado: no cierra este diálogo) */}
        <DishOptionsDialog
          item={picking}
          confirmLabel="Elegir"
          onClose={() => setPicking(null)}
          onConfirm={(choice) => { if (picking) setReplacement({ item: picking, choice }); setPicking(null); }}
        />
      </DialogContent>
    </Dialog>
  );
}
