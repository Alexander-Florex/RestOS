// ──────────────────────────────────────────────
// ChangesPage.tsx — Cambios y platos rehechos (tarea 5.8)
// Pendientes para autorizar + historial con las pérdidas (lo que se tiró y no
// se cobró). Permiso orders.change.approve (Caja y Administrador).
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Replace, RotateCcw } from 'lucide-react';
import { ordersApi, type ItemChange } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { formatDateTime, formatMoney } from '../lib/format';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import { ChangeRequestCard, FAULT_LABEL, usePendingChanges } from './ChangeRequests';
import { ItemModifiers } from './ItemModifiers';
import { tableLabel } from '../lib/table-label';

const RANGES = [['Hoy', 1], ['7 días', 7], ['30 días', 30]] as const;

export function ChangesPage() {
  const { changes: pending } = usePendingChanges();
  const [days, setDays] = useState<number>(1);
  const [history, setHistory] = useState<ItemChange[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - (days - 1));
    try {
      const { changes } = await ordersApi.listChanges({ from, to });
      setHistory(changes.filter(c => c.status !== 'PENDING'));
    } catch { setHistory([]); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const socket = getSocket();
    const on = () => { void load(); };
    socket.on(SocketEvents.ORDER_CHANGE_RESOLVED, on);
    return () => { socket.off(SocketEvents.ORDER_CHANGE_RESOLVED, on); };
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pérdidas: lo rehecho y lo cambiado que ya estaba hecho. No cobrado: todo lo cambiado.
  const totals = useMemo(() => {
    const applied = history.filter(c => c.status === 'APPLIED');
    const value = (c: ItemChange) => Number(c.itemSnapshot.price) * c.quantity;
    const losses = applied.filter(c => c.wasPrepared);
    return {
      lossCount: losses.reduce((s, c) => s + c.quantity, 0),
      lossValue: losses.reduce((s, c) => s + value(c), 0),
      notCharged: applied.filter(c => c.type === 'REPLACE').reduce((s, c) => s + value(c), 0),
      byFault: Object.entries(
        applied.reduce<Record<string, number>>((acc, c) => { const k = c.fault ?? 'OTHER'; acc[k] = (acc[k] ?? 0) + c.quantity; return acc; }, {}),
      ),
    };
  }, [history]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400">
            <span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Servicio
          </p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Cambios de platos</h2>
          <p className="text-sm text-muted-foreground">Pedidos de cambio para autorizar, platos rehechos y pérdidas</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-label="Refrescar">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      <section className="mb-6">
        <h3 className="mb-2 text-sm font-semibold">Para autorizar {pending.length > 0 && `(${pending.length})`}</h3>
        {pending.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-muted-foreground">
            No hay pedidos de cambio esperando
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {pending.map(c => <ChangeRequestCard key={c.id} change={c} />)}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Historial</h3>
          <div className="flex gap-1.5">
            {RANGES.map(([label, d]) => (
              <button key={label} onClick={() => setDays(d)}
                className={cn('rounded-full border px-3 py-1.5 text-xs font-medium',
                  days === d ? 'border-brand-500/50 bg-brand-500/10 text-brand-400' : 'border-border bg-white/[0.04] text-muted-foreground')}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Pérdidas (platos tirados)" value={`${totals.lossCount}`} sub={formatMoney(totals.lossValue)} tone="text-rose-300" />
          <Stat label="No cobrado por cambios" value={formatMoney(totals.notCharged)} sub="valor de venta" />
          <Stat label="Por causa" value={totals.byFault.length ? '' : '—'}
            sub={totals.byFault.map(([k, n]) => `${FAULT_LABEL[k]}: ${n}`).join(' · ')} />
        </div>

        {history.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-muted-foreground">Sin cambios en el período</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {history.map(c => (
              <li key={c.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <span className="w-32 shrink-0 text-xs tabular-nums text-muted-foreground">{formatDateTime(c.createdAt)}</span>
                <span className={cn('flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  c.status === 'REJECTED' ? 'bg-white/[0.06] text-muted-foreground'
                    : c.type === 'REMAKE' ? 'bg-amber-500/15 text-amber-300' : 'bg-brand-500/15 text-brand-300')}>
                  {c.type === 'REMAKE' ? <RotateCcw className="h-3 w-3" /> : <Replace className="h-3 w-3" />}
                  {c.status === 'REJECTED' ? 'Rechazado' : c.type === 'REMAKE' ? 'Rehecho' : 'Cambiado'}
                </span>
                <div className="min-w-0 flex-1">
                  <p>
                    {tableLabel(c.order.table)} · {c.quantity}x {c.itemSnapshot.itemName}
                    {c.type === 'REPLACE' && ` → ${c.replacementName ?? 'otro plato'}`}
                  </p>
                  <ItemModifiers modifiers={c.itemSnapshot.modifiers} />
                  <p className="text-xs text-muted-foreground">
                    {c.fault && `${FAULT_LABEL[c.fault]} · `}{c.wasPrepared ? 'pérdida · ' : ''}Motivo: {c.reason}
                    {c.rejectReason && ` · Rechazo: ${c.rejectReason}`}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {c.requestedBy?.name}{c.resolvedBy && c.resolvedBy.id !== c.requestedBy?.id ? ` · aprobó ${c.resolvedBy.name}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      {value && <p className={cn('mt-1 font-display text-xl font-bold tabular-nums', tone)}>{value}</p>}
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
