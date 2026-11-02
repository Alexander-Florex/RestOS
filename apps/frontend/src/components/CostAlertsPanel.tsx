// ──────────────────────────────────────────────
// CostAlertsPanel.tsx — Alertas de costos (tarea 2.8)
// Insumos que subieron en el período y qué platos pierden margen, con el
// precio (con IVA) que restablece el margen objetivo.
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, TrendingUp } from 'lucide-react';
import { recipesApi, type CostAlert } from '../lib/api';
import { formatDateTime, formatMoney } from '../lib/format';
import { cn } from '../lib/utils';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 1000) / 10}%`);

export function CostAlertsPanel({ refreshKey }: { refreshKey?: unknown }) {
  const [days, setDays] = useState(30);
  const [alerts, setAlerts] = useState<CostAlert[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    recipesApi.costAlerts(days).then(r => setAlerts(r.alerts)).catch(() => setAlerts([]));
  }, [days, refreshKey]);

  if (alerts.length === 0) return null;
  const below = alerts.reduce((n, a) => n + a.dishes.filter(d => d.belowTarget).length, 0);

  return (
    <section className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-500/5">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
        <span className="flex-1 text-sm font-semibold text-amber-100">
          {alerts.length === 1 ? '1 insumo subió' : `${alerts.length} insumos subieron`} en los últimos {days} días
          {below > 0 && <span className="font-normal text-amber-200"> · {below} {below === 1 ? 'plato quedó' : 'platos quedaron'} debajo del margen objetivo</span>}
        </span>
        <ChevronDown className={cn('h-4 w-4 text-amber-200 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-amber-400/20 px-4 py-3">
          <div className="flex gap-1.5">
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setDays(d)}
                className={cn('rounded-full border px-2.5 py-1 text-xs', days === d ? 'border-amber-300/50 bg-amber-500/15 text-amber-100' : 'border-border text-muted-foreground')}>
                {d} días
              </button>
            ))}
          </div>
          {alerts.map(a => (
            <div key={a.inventoryItemId} className="rounded-xl border border-white/[0.07] bg-background/40 p-3 text-sm">
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold">{a.itemName}</span>
                <span className="tabular-nums text-muted-foreground">{formatMoney(a.previousCost)} → {formatMoney(a.currentCost)} / {a.unit}</span>
                <span className="flex items-center gap-0.5 text-xs text-rose-300"><TrendingUp className="h-3 w-3" />+{pct(a.changePct)}</span>
                <span className="text-xs text-muted-foreground">· {formatDateTime(a.changedAt)}</span>
              </p>
              {a.dishes.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="py-1 text-left font-medium">Plato</th>
                        <th className="py-1 text-right font-medium">Costo</th>
                        <th className="py-1 text-right font-medium">Margen antes → ahora</th>
                        <th className="py-1 text-right font-medium">Objetivo</th>
                        <th className="py-1 text-right font-medium">Precio sugerido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.dishes.map(d => (
                        <tr key={d.recipeId} className={cn(d.belowTarget && 'text-rose-200')}>
                          <td className="py-1">{d.menuItemName}</td>
                          <td className="py-1 text-right tabular-nums">{formatMoney(d.costBefore)} → {formatMoney(d.costNow)}</td>
                          <td className="py-1 text-right tabular-nums">{pct(d.previousMargin)} → {pct(d.currentMargin)}</td>
                          <td className="py-1 text-right tabular-nums">{pct(d.targetMargin)}</td>
                          <td className="py-1 text-right font-semibold tabular-nums">
                            {d.suggestedPrice !== null ? formatMoney(d.suggestedPrice) : '—'}
                            {d.menuItemPrice !== null && <span className="block font-normal text-muted-foreground">hoy {formatMoney(d.menuItemPrice)}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {a.otherRecipes.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">También afecta a: {a.otherRecipes.join(', ')}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
