// ──────────────────────────────────────────────
// ReportsPage.tsx — Reportes diarios + mensuales
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Calendar, TrendingUp, ShoppingBag, DollarSign, Loader2,
  FileDown, RefreshCw, Trophy, Sun, BarChart3, ChevronLeft, ChevronRight, Receipt,
} from 'lucide-react';
import { reportsApi, type SalesReport, type TopItem, type DailyTicket, type PaymentMethod, ApiError } from '../lib/api';
import { PAYMENT_LABEL } from '../lib/menu-helpers';
import { formatMoney } from '../lib/format';
import { localDateString } from '../lib/reservation-helpers';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

const PAYMENT_COLOR: Record<string, string> = {
  CASH:     '#10b981',
  CARD:     '#3b82f6',
  TRANSFER: '#a855f7',
};

type ViewMode = 'daily' | 'monthly' | 'custom';

export function ReportsPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('daily');

  // Vista diaria — día seleccionado
  const [selectedDay, setSelectedDay] = useState(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d;
  });

  // Vista mensual — mes seleccionado
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Rango personalizado
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); d.setHours(0,0,0,0); return d;
  });
  const [customTo, setCustomTo] = useState(() => {
    const d = new Date(); d.setHours(23,59,59,999); return d;
  });

  const [report, setReport] = useState<SalesReport | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [prevMonthReport, setPrevMonthReport] = useState<SalesReport | null>(null);
  const [tickets, setTickets] = useState<DailyTicket[]>([]);
  const [ticketTableFilter, setTicketTableFilter] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Calcular from/to según el modo
  const { from, to } = useMemo(() => {
    if (viewMode === 'daily') {
      const from = new Date(selectedDay); from.setHours(0,0,0,0);
      const to   = new Date(selectedDay); to.setHours(23,59,59,999);
      return { from, to };
    }
    if (viewMode === 'monthly') {
      const from = new Date(selectedMonth.year, selectedMonth.month, 1, 0, 0, 0);
      const to   = new Date(selectedMonth.year, selectedMonth.month + 1, 0, 23, 59, 59);
      return { from, to };
    }
    return { from: customFrom, to: customTo };
  }, [viewMode, selectedDay, selectedMonth, customFrom, customTo]);

  async function load() {
    setLoading(true);
    try {
      const [r, t] = await Promise.all([
        reportsApi.salesReport(from, to),
        reportsApi.topItems(from, to, 10),
      ]);
      setReport(r);
      setTopItems(t.items);

      // Para la vista mensual, cargar también el mes anterior para comparar
      if (viewMode === 'monthly') {
        const prevFrom = new Date(selectedMonth.year, selectedMonth.month - 1, 1, 0, 0, 0);
        const prevTo   = new Date(selectedMonth.year, selectedMonth.month, 0, 23, 59, 59);
        const prev = await reportsApi.salesReport(prevFrom, prevTo).catch(() => null);
        setPrevMonthReport(prev);
      } else {
        setPrevMonthReport(null);
      }

      // Listado de tickets — solo tiene sentido en la vista diaria
      if (viewMode === 'daily') {
        const { tickets: dayTickets } = await reportsApi.dailyTickets(selectedDay);
        setTickets(dayTickets);
        setTicketTableFilter(null);
      } else {
        setTickets([]);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al cargar el reporte');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [from.getTime(), to.getTime(), viewMode]);

  function shiftDay(delta: number) {
    const d = new Date(selectedDay);
    d.setDate(d.getDate() + delta);
    setSelectedDay(d);
  }

  function shiftMonth(delta: number) {
    setSelectedMonth(prev => {
      let m = prev.month + delta;
      let y = prev.year;
      if (m < 0)  { m = 11; y--; }
      if (m > 11) { m = 0;  y++; }
      return { year: y, month: m };
    });
  }

  const isToday = localDateString(selectedDay) === localDateString(new Date());
  const isCurrentMonth = selectedMonth.year === new Date().getFullYear() && selectedMonth.month === new Date().getMonth();

  const MONTH_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  const totals = report?.totals;

  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Negocio</p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Reportes</h2>
          <p className="text-sm text-muted-foreground">Ventas por día y por mes</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button size="sm"
            onClick={() => window.open(reportsApi.csvUrl(from, to), '_blank')}
            disabled={!report || report.totals.salesCount === 0}>
            <FileDown className="h-4 w-4" />
            CSV
          </Button>
        </div>
      </div>

      {/* Tabs de modo */}
      <div className="mb-6 flex gap-2 glass rounded-3xl p-1.5">
        {([['daily','Hoy / Día'], ['monthly', 'Por mes'], ['custom', 'Rango']] as const).map(([mode, label]) => (
          <button key={mode} onClick={() => setViewMode(mode)}
            className={cn(
              'flex-1 rounded-xl py-2 text-xs font-medium transition-colors',
              viewMode === mode
                ? 'bg-brand-500/10 text-brand-400 border border-brand-500/30'
                : 'text-muted-foreground hover:text-foreground'
            )}>
            {label}
          </button>
        ))}
      </div>

      {/* Selector de día */}
      {viewMode === 'daily' && (
        <div className="mb-6 flex items-center justify-between glass rounded-3xl p-3">
          <Button variant="ghost" size="icon" onClick={() => shiftDay(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="text-center">
            {isToday && <p className="text-[10px] uppercase tracking-wider text-brand-400 font-medium">Hoy</p>}
            <p className="text-base font-semibold capitalize">
              {selectedDay.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' })}
            </p>
            {!isToday && (
              <button onClick={() => { const d = new Date(); d.setHours(0,0,0,0); setSelectedDay(d); }}
                className="text-[10px] text-brand-400 hover:underline">Volver a hoy</button>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={() => shiftDay(1)} disabled={isToday}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}

      {/* Selector de mes */}
      {viewMode === 'monthly' && (
        <div className="mb-6 flex items-center justify-between glass rounded-3xl p-3">
          <Button variant="ghost" size="icon" onClick={() => shiftMonth(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="text-center">
            {isCurrentMonth && <p className="text-[10px] uppercase tracking-wider text-brand-400 font-medium">Mes actual</p>}
            <p className="text-base font-semibold">
              {MONTH_NAMES[selectedMonth.month]} {selectedMonth.year}
            </p>
            {!isCurrentMonth && (
              <button onClick={() => { const d = new Date(); setSelectedMonth({ year: d.getFullYear(), month: d.getMonth() }); }}
                className="text-[10px] text-brand-400 hover:underline">Mes actual</button>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={() => shiftMonth(1)} disabled={isCurrentMonth}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}

      {/* Selector rango personalizado */}
      {viewMode === 'custom' && (
        <div className="mb-6 glass rounded-3xl p-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Desde</label>
              <input type="date" value={localDateString(customFrom)}
                onChange={e => { const d = new Date(e.target.value); d.setHours(0,0,0,0); setCustomFrom(d); }}
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Hasta</label>
              <input type="date" value={localDateString(customTo)}
                onChange={e => { const d = new Date(e.target.value); d.setHours(23,59,59,999); setCustomTo(d); }}
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !report || report.totals.salesCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {viewMode === 'daily'
              ? isToday ? 'No hay ventas registradas hoy todavía.' : 'No hubo ventas ese día.'
              : viewMode === 'monthly' ? `No hubo ventas en ${MONTH_NAMES[selectedMonth.month]} ${selectedMonth.year}.`
              : 'No hay ventas en ese rango.'}
          </p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard icon={DollarSign} label="Total facturado" value={formatMoney(totals!.totalSold)}
              sublabel={`${totals!.salesCount} ${totals!.salesCount === 1 ? 'venta' : 'ventas'}`} highlight />
            <KpiCard icon={TrendingUp} label="Ticket promedio" value={formatMoney(totals!.averageTicket)} sublabel="Por venta" />
            <KpiCard icon={ShoppingBag} label="Total cobrado" value={formatMoney(totals!.totalCollected)} sublabel="Monto recibido" />
            <KpiCard icon={Calendar} label={viewMode === 'daily' ? 'Ventas hoy' : 'Días con ventas'}
              value={viewMode === 'daily' ? String(totals!.salesCount) : String(report!.byDay.length)}
              sublabel={viewMode === 'daily' ? 'En el día' : 'Del período'} />
          </div>

          {/* Breakdown por método de pago — el más importante según lo pedido */}
          <div className="mb-6 glass rounded-3xl p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Sun className="h-4 w-4 text-brand-400" />
              Recaudación por método de pago
              {viewMode === 'daily' && isToday && (
                <span className="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-brand-400">Hoy</span>
              )}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(['CASH','CARD','TRANSFER'] as PaymentMethod[]).map(method => {
                const d = report!.byPaymentMethod.find(x => x.method === method);
                const amount = d?.amount ?? 0;
                const count  = d?.count ?? 0;
                const pct    = d?.percentage ?? 0;
                return (
                  <div key={method}
                    className={cn('rounded-xl border p-4 transition-colors',
                      amount > 0 ? 'border-border bg-white/[0.03]' : 'border-dashed border-white/10 opacity-40')}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: PAYMENT_COLOR[method] }} />
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {PAYMENT_LABEL[method]}
                      </span>
                    </div>
                    <p className="text-2xl font-bold tabular-nums" style={{ color: amount > 0 ? PAYMENT_COLOR[method] : undefined }}>
                      {formatMoney(amount)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {count} {count === 1 ? 'venta' : 'ventas'}
                      {pct > 0 && ` · ${pct.toFixed(1)}%`}
                    </p>
                    {amount > 0 && (
                      <div className="mt-2 h-1.5 w-full rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: PAYMENT_COLOR[method] }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tickets del día — listado de cuentas cerradas, solo en vista diaria */}
          {viewMode === 'daily' && tickets.length > 0 && (
            <div className="mb-6 glass rounded-3xl p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Receipt className="h-4 w-4 text-brand-400" />
                  Tickets del día ({tickets.length})
                </h3>
                {report!.byTable.length > 1 && (
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setTicketTableFilter(null)}
                      className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                        ticketTableFilter === null ? 'bg-brand-500/10 text-brand-400 border border-brand-500/30' : 'text-muted-foreground hover:text-foreground border border-transparent')}>
                      Todas
                    </button>
                    {report!.byTable.map(t => (
                      <button key={t.tableNumber} onClick={() => setTicketTableFilter(t.tableNumber)}
                        className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                          ticketTableFilter === t.tableNumber ? 'bg-brand-500/10 text-brand-400 border border-brand-500/30' : 'text-muted-foreground hover:text-foreground border border-transparent')}>
                        Mesa {t.tableNumber} ({t.count})
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Hora</th>
                      <th className="pb-2 pr-3 font-medium">Mesa</th>
                      <th className="pb-2 pr-3 font-medium">Items</th>
                      <th className="pb-2 pr-3 font-medium">Pago</th>
                      <th className="pb-2 pr-3 font-medium">Cobró</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tickets
                      .filter(t => ticketTableFilter === null || t.tableNumber === ticketTableFilter)
                      .map(t => (
                        <tr key={t.id} className="border-b border-border/50 last:border-0">
                          <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                            {new Date(t.closedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-2 pr-3 font-medium">Mesa {t.tableNumber}</td>
                          <td className="py-2 pr-3 max-w-xs truncate text-muted-foreground" title={t.items.map(i => `${i.quantity}x ${i.itemName}`).join(', ')}>
                            {t.items.map(i => `${i.quantity}x ${i.itemName}`).join(', ')}
                          </td>
                          <td className="py-2 pr-3">
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{ background: `${PAYMENT_COLOR[t.paymentMethod]}1a`, color: PAYMENT_COLOR[t.paymentMethod] }}>
                              {PAYMENT_LABEL[t.paymentMethod]}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">{t.registeredByName ?? '—'}</td>
                          <td className="py-2 text-right font-semibold tabular-nums">{formatMoney(t.total)}</td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      <td colSpan={5} className="pt-2 text-right text-xs uppercase tracking-wider text-muted-foreground">Total</td>
                      <td className="pt-2 text-right tabular-nums text-brand-400">
                        {formatMoney(
                          tickets
                            .filter(t => ticketTableFilter === null || t.tableNumber === ticketTableFilter)
                            .reduce((sum, t) => sum + t.total, 0)
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Comparación con mes anterior — solo en vista mensual */}
          {viewMode === 'monthly' && prevMonthReport && (
            <div className="mb-6 glass rounded-3xl p-5">
              <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                <BarChart3 className="h-4 w-4 text-sky-400" />
                Comparación con {MONTH_NAMES[selectedMonth.month === 0 ? 11 : selectedMonth.month - 1]}
              </h3>
              <div className="space-y-3">
                {[
                  { label: 'Total facturado', curr: totals!.totalSold, prev: prevMonthReport.totals.totalSold },
                  { label: 'Ventas realizadas', curr: totals!.salesCount, prev: prevMonthReport.totals.salesCount, isCount: true },
                  { label: 'Ticket promedio', curr: totals!.averageTicket, prev: prevMonthReport.totals.averageTicket },
                ].map(row => {
                  const diff = row.curr - row.prev;
                  const pct = row.prev > 0 ? ((diff / row.prev) * 100) : 0;
                  const up = diff >= 0;
                  return (
                    <div key={row.label} className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">{row.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {row.isCount ? row.prev : formatMoney(row.prev)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-semibold tabular-nums">
                          {row.isCount ? row.curr : formatMoney(row.curr)}
                        </span>
                        {row.prev > 0 && (
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums',
                            up ? 'bg-brand-500/10 text-brand-400' : 'bg-rose-500/10 text-rose-400')}>
                            {up ? '+' : ''}{pct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Gráfico por día (solo en rango personalizado o mensual) */}
          {(viewMode === 'monthly' || viewMode === 'custom') && report.byDay.length > 1 && (
            <div className="mb-6 glass rounded-3xl p-5">
              <h3 className="mb-4 text-sm font-semibold">Ventas por día</h3>
              <DailyChart data={report.byDay} />
            </div>
          )}

          {/* Top items */}
          <div className="glass rounded-3xl p-5">
            <div className="mb-4 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold">Top 10 ítems más vendidos</h3>
            </div>
            {topItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin datos de ítems para este período.
              </p>
            ) : (
              <div className="space-y-2">
                {topItems.map((item, idx) => {
                  const maxQty = topItems[0].quantity;
                  const widthPct = maxQty > 0 ? (item.quantity / maxQty) * 100 : 0;
                  return (
                    <div key={`${item.itemName}-${idx}`} className="relative overflow-hidden rounded-lg bg-white/[0.04] p-3">
                      <div className="absolute inset-y-0 left-0 bg-brand-500/15" style={{ width: `${widthPct}%` }} />
                      <div className="relative flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card font-bold tabular-nums text-brand-400">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{item.itemName}</p>
                            <p className="text-xs text-muted-foreground">{item.category}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-4 text-sm">
                          <span className="tabular-nums">
                            <span className="font-bold">{item.quantity}</span>
                            <span className="text-xs text-muted-foreground"> uds</span>
                          </span>
                          <span className="tabular-nums font-semibold text-brand-400 w-24 text-right">
                            {formatMoney(item.revenue)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sublabel, highlight }: {
  icon: typeof DollarSign; label: string; value: string; sublabel: string; highlight?: boolean;
}) {
  return (
    <div className={cn('rounded-2xl border p-4', highlight ? 'border-brand-500/40 bg-brand-500/5' : 'border-border bg-card')}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className={cn('h-4 w-4', highlight && 'text-brand-400')} />
        {label}
      </div>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums', highlight ? 'text-brand-400' : 'text-foreground')}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground truncate">{sublabel}</p>
    </div>
  );
}

function DailyChart({ data }: { data: SalesReport['byDay'] }) {
  if (data.length === 0) return null;
  const maxTotal = Math.max(...data.map(d => d.total));
  const width = 460, height = 160;
  const pad = { top: 10, right: 10, bottom: 25, left: 44 };
  const cW = width - pad.left - pad.right;
  const cH = height - pad.top - pad.bottom;
  const bW = cW / data.length;
  const ibW = Math.max(4, Math.min(bW - 4, 36));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <line x1={pad.left} y1={pad.top + cH} x2={pad.left + cW} y2={pad.top + cH}
          stroke="hsl(217 33% 22%)" strokeWidth="1" />
        {maxTotal > 0 && (
          <text x={pad.left - 4} y={pad.top + 4} textAnchor="end" fontSize="9" fill="hsl(215 20% 55%)">
            {maxTotal >= 1000 ? `${(maxTotal/1000).toFixed(0)}k` : Math.round(maxTotal)}
          </text>
        )}
        {data.map((d, i) => {
          const h = maxTotal > 0 ? (d.total / maxTotal) * cH : 0;
          const x = pad.left + i * bW + (bW - ibW) / 2;
          const y = pad.top + cH - h;
          const show = data.length <= 12 || i % Math.ceil(data.length / 12) === 0;
          return (
            <g key={d.date}>
              <rect x={x} y={y} width={ibW} height={h} fill="#10b981" rx="2" opacity="0.85">
                <title>{d.date}: {formatMoney(d.total)} · {d.count} ventas</title>
              </rect>
              {show && (
                <text x={x + ibW / 2} y={pad.top + cH + 14} textAnchor="middle" fontSize="8" fill="hsl(215 20% 55%)">
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
