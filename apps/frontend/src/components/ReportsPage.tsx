// ──────────────────────────────────────────────
// ReportsPage.tsx — Reportes de ventas con gráficos SVG
// Sin dependencias extra: gráficos hechos a mano con SVG.
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Calendar, TrendingUp, ShoppingBag, DollarSign, Loader2,
  FileDown, RefreshCw, Trophy,
} from 'lucide-react';
import {
  reportsApi, type SalesReport, type TopItem, type PaymentMethod, ApiError,
} from '../lib/api';
import { PAYMENT_LABEL, categoryLabel } from '../lib/menu-helpers';
import { formatMoney } from '../lib/format';
import { localDateString } from '../lib/reservation-helpers';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { cn } from '../lib/utils';

const PAYMENT_COLOR: Record<PaymentMethod, string> = {
  CASH:     '#10b981', // emerald
  CARD:     '#3b82f6', // blue
  TRANSFER: '#a855f7', // purple
};

export function ReportsPage() {
  // Rango: por defecto últimos 30 días
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [to, setTo] = useState(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  });

  const [report, setReport] = useState<SalesReport | null>(null);
  const [topItems, setTopItems] = useState<TopItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [r, t] = await Promise.all([
        reportsApi.salesReport(from, to),
        reportsApi.topItems(from, to, 10),
      ]);
      setReport(r);
      setTopItems(t.items);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al cargar el reporte');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-line */ }, [from.getTime(), to.getTime()]);

  function applyPreset(days: number) {
    const newTo = new Date();
    newTo.setHours(23, 59, 59, 999);
    const newFrom = new Date(newTo);
    newFrom.setDate(newFrom.getDate() - days + 1);
    newFrom.setHours(0, 0, 0, 0);
    setFrom(newFrom);
    setTo(newTo);
  }

  function applyThisMonth() {
    const now = new Date();
    setFrom(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0));
    setTo(new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59));
  }

  function downloadCsv() {
    window.open(reportsApi.csvUrl(from, to), '_blank');
  }

  const totals = report?.totals;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Reportes</h2>
          <p className="text-sm text-muted-foreground">
            Resumen de ventas en el rango seleccionado
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refrescar
          </Button>
          <Button size="sm" onClick={downloadCsv} disabled={!report || report.totals.salesCount === 0}>
            <FileDown className="h-4 w-4" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Selector de rango */}
      <div className="mb-6 rounded-2xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="from">Desde</Label>
            <Input
              id="from" type="date"
              value={localDateString(from)}
              onChange={(e) => {
                const d = new Date(e.target.value);
                d.setHours(0, 0, 0, 0);
                setFrom(d);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">Hasta</Label>
            <Input
              id="to" type="date"
              value={localDateString(to)}
              onChange={(e) => {
                const d = new Date(e.target.value);
                d.setHours(23, 59, 59, 999);
                setTo(d);
              }}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <PresetChip onClick={() => applyPreset(1)} label="Hoy" />
          <PresetChip onClick={() => applyPreset(7)} label="Últimos 7 días" />
          <PresetChip onClick={() => applyPreset(30)} label="Últimos 30 días" />
          <PresetChip onClick={applyThisMonth} label="Este mes" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !report || report.totals.salesCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No hay ventas en este rango
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard
              icon={DollarSign}
              label="Total facturado"
              value={formatMoney(totals!.totalSold)}
              sublabel={`${totals!.salesCount} ${totals!.salesCount === 1 ? 'venta' : 'ventas'}`}
              highlight
            />
            <KpiCard
              icon={ShoppingBag}
              label="Total cobrado"
              value={formatMoney(totals!.totalCollected)}
              sublabel={totals!.totalCollected > totals!.totalSold
                ? `+${formatMoney(totals!.totalCollected - totals!.totalSold)} sobre el total`
                : 'Mismo que facturado'}
            />
            <KpiCard
              icon={TrendingUp}
              label="Ticket promedio"
              value={formatMoney(totals!.averageTicket)}
              sublabel="Por venta"
            />
            <KpiCard
              icon={Calendar}
              label="Días con ventas"
              value={String(report.byDay.length)}
              sublabel={`De ${daysBetween(from, to)} días en rango`}
            />
          </div>

          {/* Breakdown por método de pago */}
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="mb-4 text-sm font-semibold">Método de pago</h3>
              <PaymentMethodChart data={report.byPaymentMethod} total={totals!.totalSold} />
            </div>

            {/* Ventas por día */}
            <div className="rounded-2xl border border-border bg-card p-5">
              <h3 className="mb-4 text-sm font-semibold">Ventas por día</h3>
              <DailyChart data={report.byDay} />
            </div>
          </div>

          {/* Top items */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-semibold">Top 10 ítems más vendidos</h3>
            </div>
            {topItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin datos. Las ventas anteriores a esta versión no tienen detalle de items;
                las próximas sí lo guardarán.
              </p>
            ) : (
              <div className="space-y-2">
                {topItems.map((item, idx) => {
                  const maxQty = topItems[0].quantity;
                  const widthPct = maxQty > 0 ? (item.quantity / maxQty) * 100 : 0;
                  return (
                    <div key={`${item.itemName}-${idx}`} className="relative overflow-hidden rounded-lg bg-secondary/30 p-3">
                      <div
                        className="absolute inset-y-0 left-0 bg-emerald-500/15"
                        style={{ width: `${widthPct}%` }}
                      />
                      <div className="relative flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card font-bold tabular-nums text-emerald-400">
                            {idx + 1}
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{item.itemName}</p>
                            <p className="text-xs text-muted-foreground">
                              {categoryLabel(item.category)}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-4 text-sm">
                          <span className="tabular-nums">
                            <span className="font-bold">{item.quantity}</span>
                            <span className="text-xs text-muted-foreground"> uds</span>
                          </span>
                          <span className="tabular-nums font-semibold text-emerald-400 w-24 text-right">
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

// ──────────────────────────────────────────────
// Sub-componentes
// ──────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sublabel, highlight,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  sublabel: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-2xl border p-4',
      highlight ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-card'
    )}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className={cn('h-4 w-4', highlight && 'text-emerald-400')} />
        {label}
      </div>
      <p className={cn(
        'mt-2 text-2xl font-bold tabular-nums',
        highlight ? 'text-emerald-400' : 'text-foreground'
      )}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground truncate">{sublabel}</p>
    </div>
  );
}

function PresetChip({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-400"
    >
      {label}
    </button>
  );
}

/** Gráfico de barras horizontales para método de pago. */
function PaymentMethodChart({
  data, total,
}: {
  data: SalesReport['byPaymentMethod'];
  total: number;
}) {
  // Solo mostramos métodos con al menos 1 venta
  const filtered = data.filter(d => d.count > 0);
  if (filtered.length === 0 || total === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos</p>;
  }

  return (
    <div className="space-y-3">
      {filtered.map(d => (
        <div key={d.method}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: PAYMENT_COLOR[d.method] }}
              />
              <span className="font-medium">{PAYMENT_LABEL[d.method]}</span>
              <span className="text-muted-foreground">· {d.count}</span>
            </span>
            <span className="tabular-nums">
              <span className="font-semibold">{formatMoney(d.amount)}</span>
              <span className="ml-1 text-muted-foreground">({d.percentage.toFixed(1)}%)</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-secondary/50">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${d.percentage}%`, background: PAYMENT_COLOR[d.method] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Gráfico de barras verticales por día. */
function DailyChart({ data }: { data: SalesReport['byDay'] }) {
  if (data.length === 0) return <p className="text-sm text-muted-foreground">Sin datos</p>;

  const maxTotal = Math.max(...data.map(d => d.total));
  const width = 460;
  const height = 180;
  const padding = { top: 10, right: 10, bottom: 30, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const barWidth = chartW / data.length;
  const innerBarW = Math.max(4, Math.min(barWidth - 6, 40));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {/* Eje Y: línea horizontal del 0 */}
        <line
          x1={padding.left} y1={padding.top + chartH}
          x2={padding.left + chartW} y2={padding.top + chartH}
          stroke="hsl(217 33% 22%)" strokeWidth="1"
        />
        {/* Etiqueta de máximo */}
        <text
          x={padding.left - 4} y={padding.top + 4}
          textAnchor="end" fontSize="10" fill="hsl(215 20% 65%)"
        >
          {formatCompactMoney(maxTotal)}
        </text>
        {/* Etiqueta de 0 */}
        <text
          x={padding.left - 4} y={padding.top + chartH + 3}
          textAnchor="end" fontSize="10" fill="hsl(215 20% 65%)"
        >
          0
        </text>

        {data.map((d, i) => {
          const h = maxTotal > 0 ? (d.total / maxTotal) * chartH : 0;
          const x = padding.left + i * barWidth + (barWidth - innerBarW) / 2;
          const y = padding.top + chartH - h;
          const showLabel = data.length <= 14 || i % Math.ceil(data.length / 14) === 0;
          return (
            <g key={d.date}>
              <rect
                x={x} y={y} width={innerBarW} height={h}
                fill="#10b981" rx="3"
                opacity="0.85"
              >
                <title>{`${d.date}: ${formatMoney(d.total)} · ${d.count} ventas`}</title>
              </rect>
              {showLabel && (
                <text
                  x={x + innerBarW / 2} y={padding.top + chartH + 14}
                  textAnchor="middle" fontSize="9" fill="hsl(215 20% 65%)"
                >
                  {d.date.slice(5)} {/* MM-DD */}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Utils internas ──

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1);
}

function formatCompactMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}
