// ──────────────────────────────────────────────
// MenuCostInfo.tsx — Costo y margen en la carta (tarea 2.7) y margen
// objetivo por categoría (tarea 2.6). Solo para quien ve recetas y costos.
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { menuCategoriesApi, recipesApi, ApiError, type MenuCategory, type MenuItemCost } from '../lib/api';
import { formatMoney } from '../lib/format';
import { cn } from '../lib/utils';

/** Costo/margen por plato. `refreshKey` cambia → se recarga (ej. al cambiar la carta). */
export function useMenuCosts(enabled: boolean, refreshKey?: unknown) {
  const [byItem, setByItem] = useState<Map<number, MenuItemCost>>(new Map());
  useEffect(() => {
    if (!enabled) return;
    recipesApi.menuCosts()
      .then(r => setByItem(new Map(r.items.map(i => [i.menuItemId, i]))))
      .catch(() => setByItem(new Map()));
  }, [enabled, refreshKey]);
  return byItem;
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** Debajo del precio del plato: costo, margen real y aviso si queda bajo el objetivo. */
export function MenuCostBadge({ cost }: { cost: MenuItemCost | undefined }) {
  if (!cost) return null;
  return (
    <p className={cn('mt-0.5 text-[11px] font-normal', cost.belowTarget ? 'text-rose-300' : 'text-muted-foreground')}
      title={`Receta "${cost.recipeName}" · margen objetivo ${pct(cost.margin)}${cost.suggestedPrice ? ` · sugerido ${formatMoney(cost.suggestedPrice)}` : ''}`}>
      Costo {formatMoney(cost.costPerServing)}
      {cost.actualMargin !== null && ` · margen ${pct(cost.actualMargin)}`}
      {cost.belowTarget && ` (obj. ${pct(cost.margin)})`}
      {!cost.complete && ' · incompleto'}
    </p>
  );
}

/** Margen objetivo editable de una categoría (se guarda al salir del campo). */
export function CategoryMarginInput({ category }: { category: MenuCategory }) {
  const initial = category.targetMargin != null ? String(Math.round(category.targetMargin * 1000) / 10) : '';
  const [value, setValue] = useState(initial);
  useEffect(() => { setValue(initial); }, [initial]);

  async function save() {
    if (value === initial) return;
    const n = value === '' ? null : Number(value) / 100;
    if (n !== null && (Number.isNaN(n) || n < 0 || n > 0.95)) {
      toast.error('El margen tiene que estar entre 0 y 95 %');
      setValue(initial);
      return;
    }
    try {
      await menuCategoriesApi.update(category.id, { targetMargin: n });
      toast.success(`Margen objetivo de "${category.name}": ${n === null ? 'sin objetivo' : pct(n)}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo guardar el margen');
      setValue(initial);
    }
  }

  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Margen objetivo sobre el precio sin IVA: se propone a las recetas nuevas de sus platos">
      Margen obj.
      <input type="number" min={0} max={95} step={1} value={value} placeholder="—"
        onChange={e => setValue(e.target.value)} onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="h-7 w-14 rounded-md border border-input bg-background px-1.5 text-right tabular-nums" aria-label={`Margen objetivo de ${category.name}`} />
      %
    </label>
  );
}
