// ──────────────────────────────────────────────
// OwnerPanel.tsx — Panel del dueño (tarea 4.4): lo importante del día, pensado para el celular.
// Ventas de hoy contra el mismo día de la semana pasada, caja, stock bajo, platos con margen
// bajo, lo que deben las cuentas corrientes y la diferencia del último conteo.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { analyticsApi, type OwnerPanel as Panel } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useResync } from '../hooks/useConnection';
import { formatMoney, formatDateTime } from '../lib/format';
import { cn } from '../lib/utils';
import { Button } from './ui/button';

export function OwnerPanel() {
  const [p, setP] = useState<Panel | null>(null);
  const refresh = useCallback(() => { analyticsApi.owner().then(setP).catch(() => {}); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useResync(refresh);
  useEffect(() => {
    const socket = getSocket();
    socket.on(SocketEvents.SALE_REGISTERED, refresh);
    socket.on(SocketEvents.CASH_CHANGED, refresh);
    return () => { socket.off(SocketEvents.SALE_REGISTERED, refresh); socket.off(SocketEvents.CASH_CHANGED, refresh); };
  }, [refresh]);

  if (!p) return <div className="flex items-center justify-center py-24 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const diff = p.today.sold - p.sameDayLastWeek.sold;
  const pct = p.sameDayLastWeek.sold > 0 ? Math.round((diff / p.sameDayLastWeek.sold) * 100) : null;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Hoy</p>
          <h2 className="font-display text-3xl font-bold tracking-tight">Panel del dueño</h2>
        </div>
        <Button variant="outline" size="icon" onClick={refresh} aria-label="Actualizar"><RefreshCw className="h-4 w-4" /></Button>
      </div>

      <section className="glass rounded-3xl p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Vendido hoy</p>
        <p className="mt-1 text-4xl font-bold tabular-nums">{formatMoney(p.today.sold)}</p>
        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
          {p.today.salesCount} {p.today.salesCount === 1 ? 'venta' : 'ventas'} · ticket promedio {formatMoney(p.today.averageTicket)}
        </p>
        {pct !== null && (
          <p className={cn('mt-2 flex items-center gap-1 text-sm font-medium', diff >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
            {diff >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {diff >= 0 ? '+' : ''}{pct}% contra el mismo día de la semana pasada ({formatMoney(p.sameDayLastWeek.sold)})
          </p>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Box label="Cobrado" value={formatMoney(p.today.collected)} />
        <Box label={p.cash.open ? 'Efectivo en caja' : 'Caja'} value={p.cash.open ? formatMoney(p.cash.expectedCash) : 'Cerrada'} />
        <Box label="Deben (cuentas corrientes)" value={formatMoney(p.receivables)} accent={p.receivables ? 'text-amber-300' : undefined} />
        <Box label="Anulado / perdido hoy" value={formatMoney(p.today.cancelledOrders.total + p.today.changes.lost)}
          accent={p.today.cancelledOrders.total + p.today.changes.lost ? 'text-rose-300' : undefined} />
      </div>

      <section className="glass rounded-3xl p-5">
        <h3 className="text-sm font-semibold">Stock bajo ({p.lowStock.count})</h3>
        {p.lowStock.count === 0 ? <p className="text-sm text-muted-foreground">Nada por debajo del mínimo.</p> : (
          <ul className="mt-2 space-y-1 text-sm">
            {p.lowStock.items.map(i => (
              <li key={i.name} className="flex justify-between"><span>{i.name}</span><span className="tabular-nums text-amber-300">{i.quantity.toLocaleString('es-AR', { maximumFractionDigits: 2 })} / {i.minStock} {i.unit}</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass rounded-3xl p-5">
        <h3 className="text-sm font-semibold">Platos con margen bajo ({p.lowMargin.length})</h3>
        {p.lowMargin.length === 0 ? <p className="text-sm text-muted-foreground">Todos los platos con receta están en su margen objetivo.</p> : (
          <ul className="mt-2 space-y-1 text-sm">
            {p.lowMargin.map(m => (
              <li key={m.name} className="flex justify-between gap-2">
                <span>{m.name}</span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">
                  {m.actualMargin !== null ? `${Math.round(m.actualMargin * 100)}%` : '—'} (objetivo {Math.round(m.target * 100)}%)
                  {m.suggestedPrice !== null && <span className="block">precio sugerido {formatMoney(m.suggestedPrice)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {p.lastCount && (
        <section className="glass rounded-3xl p-5 text-sm">
          <h3 className="font-semibold">Último conteo de stock</h3>
          <p className="text-muted-foreground">{p.lastCount.area}{p.lastCount.closedAt ? ` · ${formatDateTime(p.lastCount.closedAt)}` : ''}</p>
          {p.lastCount.differenceValue !== null && (
            <p className={cn('mt-1 text-lg font-bold tabular-nums', p.lastCount.differenceValue < 0 ? 'text-rose-300' : 'text-emerald-300')}>
              Diferencia: {formatMoney(p.lastCount.differenceValue)}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Box({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="glass rounded-2xl p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-lg font-bold tabular-nums', accent)}>{value}</p>
    </div>
  );
}
