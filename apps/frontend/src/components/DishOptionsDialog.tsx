// ──────────────────────────────────────────────
// DishOptionsDialog.tsx — Personalizar un plato al tomar el pedido (tarea 5.7)
//
// - Ingredientes: vienen todos incluidos; se toca el que el cliente NO quiere.
// - Elegir uno (ej. término): obligatorio si así lo cargó el Administrador.
// - Agregados: opcionales, con su recargo.
// - Nota libre siempre visible ("aderezo aparte", "bien caliente"...).
// Mobile-first: botones grandes para el celular del mozo.
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Check, Minus, Plus, MessageSquare } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import type { MenuItem, MenuOptionGroup } from '../lib/api';
import { defaultOptionIds, missingRequired, unitPrice } from '../lib/modifiers';
import { formatMoney } from '../lib/format';
import { cn } from '../lib/utils';

export interface DishChoice {
  optionIds: number[];
  notes: string;
  quantity: number;
}

interface DishOptionsDialogProps {
  item: MenuItem | null;
  /** Para editar una línea ya cargada; si no, arranca con lo que viene por defecto. */
  initial?: Partial<DishChoice>;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (choice: DishChoice) => void;
}

const GROUP_HINT: Record<MenuOptionGroup['type'], string> = {
  REMOVE: 'Tocá lo que el cliente NO quiere',
  SINGLE: 'Elegí una',
  MULTI: 'Opcional, con recargo',
};

export function DishOptionsDialog({ item, initial, confirmLabel, onClose, onConfirm }: DishOptionsDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [showMissing, setShowMissing] = useState(false);

  // Reiniciar cada vez que se abre (o cambia de plato). `initial` se lee en ese
  // momento: si estuviera en las dependencias, un objeto nuevo en cada render
  // borraría lo que el mozo va eligiendo.
  useEffect(() => {
    if (!item) return;
    setSelected(new Set(initial?.optionIds ?? defaultOptionIds(item)));
    setNotes(initial?.notes ?? '');
    setQuantity(initial?.quantity ?? 1);
    setShowMissing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const optionIds = useMemo(() => [...selected], [selected]);
  const missing = item ? missingRequired(item, optionIds) : [];
  const price = item ? unitPrice(item, optionIds) : 0;

  function toggle(group: MenuOptionGroup, optionId: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (group.type === 'SINGLE') {
        // Una sola por grupo; tocar la elegida la deja sin elegir (si no es obligatorio)
        const wasOn = next.has(optionId);
        for (const o of group.options) next.delete(o.id);
        if (!wasOn || group.required) next.add(optionId);
      } else if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
      }
      return next;
    });
  }

  function confirm() {
    if (missing.length > 0) { setShowMissing(true); return; }
    onConfirm({ optionIds, notes: notes.trim(), quantity });
  }

  return (
    <Dialog open={item !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{item?.name}</DialogTitle>
          <DialogDescription>
            {item && formatMoney(item.price)}
            {item?.description ? ` · ${item.description}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {item?.optionGroups?.map(group => {
            const isMissing = showMissing && missing.some(m => m.id === group.id);
            return (
              <section key={group.id}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className={cn('text-sm font-semibold', isMissing && 'text-rose-400')}>
                    {group.name}
                    {group.required && (
                      <span className={cn(
                        'ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                        isMissing ? 'bg-rose-500/20 text-rose-300' : 'bg-white/[0.06] text-muted-foreground',
                      )}>Obligatorio</span>
                    )}
                  </h3>
                  <span className="text-[11px] text-muted-foreground">{GROUP_HINT[group.type]}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {group.options.map(o => {
                    const on = selected.has(o.id);
                    // En "sacar", estar elegido = se saca (se muestra tachado)
                    const removed = group.type === 'REMOVE' && on;
                    const active = group.type === 'REMOVE' ? !on : on;
                    const delta = Number(o.priceDelta);
                    return (
                      <button key={o.id} type="button" onClick={() => toggle(group, o.id)}
                        aria-pressed={on}
                        className={cn(
                          'flex min-h-11 items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm transition-colors',
                          removed && 'border-rose-400/40 bg-rose-500/10 text-rose-300 line-through',
                          !removed && active && 'border-brand-400/60 bg-brand-500/15 text-foreground',
                          !removed && !active && 'border-white/[0.08] bg-white/[0.03] text-muted-foreground',
                        )}>
                        {group.type === 'REMOVE'
                          ? (removed ? <span className="no-underline">SIN</span> : <Check className="h-3.5 w-3.5 text-brand-300" />)
                          : on && <Check className="h-3.5 w-3.5 text-brand-300" />}
                        <span>{o.name}</span>
                        {group.type !== 'REMOVE' && delta > 0 && (
                          <span className="text-xs tabular-nums text-brand-300">+{formatMoney(delta)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {isMissing && <p className="mt-1.5 text-xs text-rose-400">Falta elegir {group.name.toLowerCase()}</p>}
              </section>
            );
          })}

          <section>
            <label htmlFor="dish-notes" className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <MessageSquare className="h-4 w-4 text-brand-400" /> Nota para cocina
            </label>
            <textarea id="dish-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} maxLength={500}
              placeholder="Ej.: aderezo aparte, bien caliente, para compartir..."
              className="w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-sm focus:border-brand-400/60 focus:outline-none focus:ring-4 focus:ring-brand-500/15" />
          </section>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Cantidad</span>
            <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-black/25 p-1">
              <button type="button" onClick={() => setQuantity(q => Math.max(1, q - 1))} aria-label="Restar"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.06]">
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-8 text-center font-display text-base font-bold tabular-nums">{quantity}</span>
              <button type="button" onClick={() => setQuantity(q => Math.min(99, q + 1))} aria-label="Sumar"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirm} className="min-h-11">
            {confirmLabel ?? 'Agregar'} · {formatMoney(price * quantity)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
