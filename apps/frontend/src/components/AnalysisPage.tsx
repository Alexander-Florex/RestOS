// ──────────────────────────────────────────────
// AnalysisPage.tsx — Análisis (fase 4, permiso "Ver reportes")
// Pestañas: Cierre del día · Rentabilidad por plato · Real contra teórico.
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Download, Loader2, Printer } from 'lucide-react';
import {
  analyticsApi, ApiError, type DailyClose, type MenuClass, type Profitability, type TheoreticalVsReal,
} from '../lib/api';
import { formatMoney } from '../lib/format';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';

const TZ = 'America/Argentina/Buenos_Aires';
const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const today = () => dayKey(new Date());
const daysAgo = (n: number) => dayKey(new Date(Date.now() - n * 86_400_000));
const fmtQty = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 });

const CLASS_LABEL: Record<MenuClass, { label: string; hint: string; style: string }> = {
  STAR:      { label: 'Estrella', hint: 'Se vende mucho y deja buena ganancia: cuidarlo.', style: 'bg-emerald-500/15 text-emerald-300' },
  PLOWHORSE: { label: 'Caballo de batalla', hint: 'Se vende mucho pero deja poco: revisar costo o precio.', style: 'bg-sky-500/15 text-sky-300' },
  PUZZLE:    { label: 'Enigma', hint: 'Deja buena ganancia pero se vende poco: promocionarlo.', style: 'bg-amber-500/15 text-amber-300' },
  DOG:       { label: 'Perro', hint: 'Se vende poco y deja poco: pensar en sacarlo.', style: 'bg-rose-500/15 text-rose-300' },
};

type Tab = 'close' | 'profit' | 'real';

export function AnalysisPage() {
  const [tab, setTab] = useState<Tab>('close');
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Negocio</p>
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Análisis</h2>
      </div>
      <div role="tablist" className="inline-flex flex-wrap rounded-2xl border border-border p-1 text-sm print:hidden">
        {([['close', 'Cierre del día'], ['profit', 'Rentabilidad por plato'], ['real', 'Real contra teórico']] as const).map(([v, l]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
            className={cn('rounded-xl px-4 py-1.5 font-medium', tab === v ? 'bg-brand-500/20 text-brand-200' : 'text-muted-foreground hover:text-foreground')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'close' && <DailyCloseTab />}
      {tab === 'profit' && <ProfitTab />}
      {tab === 'real' && <RealTab />}
    </div>
  );
}

function Range({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Del</span>
      <Input type="date" className="w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
      <span className="text-muted-foreground">al</span>
      <Input type="date" className="w-40" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} />
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="glass rounded-2xl p-4 print:border print:border-black/20">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-xl font-bold tabular-nums', accent)}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function DailyCloseTab() {
  const [day, setDay] = useState(today());
  const [d, setD] = useState<DailyClose | null>(null);
  useEffect(() => {
    setD(null);
    analyticsApi.dailyClose(day).then(setD).catch(err => toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar'));
  }, [day]);
  const n = (c: number, w: string) => `${c} ${w}${c === 1 ? '' : 's'}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Input type="date" className="w-44" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
        <Button variant="outline" size="sm" onClick={() => analyticsApi.downloadDailyClose(day).catch(() => toast.error('No se pudo descargar'))}>
          <Download className="h-4 w-4" /> CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir / PDF</Button>
      </div>
      {!d ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
        <>
          <h3 className="hidden text-lg font-bold print:block">Cierre del {d.day}</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Vendido" value={formatMoney(d.sold)} sub={n(d.salesCount, 'venta')} />
            <Stat label="Cobrado" value={formatMoney(d.collected)} accent="text-emerald-300" sub="Incluye cobros de cuentas corrientes" />
            <Stat label="Ticket promedio" value={formatMoney(d.averageTicket)} />
            <Stat label="A cuenta (sin cobrar)" value={formatMoney(d.onAccount.total)} sub={n(d.onAccount.count, 'venta')} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Efectivo" value={formatMoney(d.byMethod.CASH)} />
            <Stat label="Tarjeta" value={formatMoney(d.byMethod.CARD)} />
            <Stat label="Transferencia" value={formatMoney(d.byMethod.TRANSFER)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Salón" value={formatMoney(d.byChannel.DINE_IN.total)} sub={n(d.byChannel.DINE_IN.count, 'venta')} />
            <Stat label="Para llevar" value={formatMoney(d.byChannel.TAKEAWAY.total)} sub={n(d.byChannel.TAKEAWAY.count, 'venta')} />
            <Stat label="Descuentos" value={formatMoney(d.discounts.total)} sub={n(d.discounts.count, 'venta')} />
            <Stat label="Cobros de cuentas corrientes" value={formatMoney(d.accountCollections.total)} sub={n(d.accountCollections.count, 'cobro')} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Pedidos anulados" value={formatMoney(d.cancelledOrders.total)} sub={n(d.cancelledOrders.count, 'pedido')} accent={d.cancelledOrders.count ? 'text-amber-300' : undefined} />
            <Stat label="Pérdida por cambios de platos" value={formatMoney(d.changes.lost)} sub={n(d.changes.count, 'cambio')} accent={d.changes.lost ? 'text-rose-300' : undefined} />
          </div>
        </>
      )}
    </div>
  );
}

function ProfitTab() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [p, setP] = useState<Profitability | null>(null);
  useEffect(() => {
    setP(null);
    analyticsApi.profitability(from, to).then(setP).catch(err => toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar'));
  }, [from, to]);
  return (
    <div className="space-y-4">
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
      {!p ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Vendido" value={formatMoney(p.totals.revenue)} />
            <Stat label="Ganancia (sin IVA)" value={formatMoney(p.totals.profit)} accent="text-emerald-300" sub="De los platos con receta" />
            <Stat label="Ganancia promedio por plato" value={formatMoney(p.totals.avgProfitPerDish)} />
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(CLASS_LABEL) as MenuClass[]).map(c => (
              <span key={c} className={cn('rounded-full px-2 py-1', CLASS_LABEL[c].style)} title={CLASS_LABEL[c].hint}>
                {CLASS_LABEL[c].label}: {CLASS_LABEL[c].hint}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Plato</th>
                  <th className="px-3 py-2 text-right font-medium">Vendidos</th>
                  <th className="px-3 py-2 text-right font-medium">Ingreso</th>
                  <th className="px-3 py-2 text-right font-medium">Costo</th>
                  <th className="px-3 py-2 text-right font-medium">Ganancia</th>
                  <th className="px-3 py-2 text-right font-medium">Margen</th>
                  <th className="px-3 py-2 text-left font-medium">Tipo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {p.dishes.map(d => (
                  <tr key={`${d.menuItemId ?? d.name}`}>
                    <td className="px-3 py-2">{d.name}{!d.hasRecipe && <span className="ml-2 text-xs text-muted-foreground">(sin receta)</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(d.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.cost !== null ? formatMoney(d.cost) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.profit !== null ? formatMoney(d.profit) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.marginPct !== null ? `${d.marginPct}%` : '—'}</td>
                    <td className="px-3 py-2">
                      {d.class && <span className={cn('rounded-full px-2 py-0.5 text-xs', CLASS_LABEL[d.class].style)} title={CLASS_LABEL[d.class].hint}>{CLASS_LABEL[d.class].label}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">El ingreso se toma sin IVA para el margen. El costo es el actual de la receta (si cambiaron precios de insumos, se usa el de hoy).</p>
        </>
      )}
    </div>
  );
}

function RealTab() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [r, setR] = useState<TheoreticalVsReal | null>(null);
  useEffect(() => {
    setR(null);
    analyticsApi.theoreticalVsReal(from, to).then(setR).catch(err => toast.error(err instanceof ApiError ? err.message : 'No se pudo cargar'));
  }, [from, to]);
  return (
    <div className="space-y-4">
      <Range from={from} to={to} setFrom={setFrom} setTo={setTo} />
      <p className="text-xs text-muted-foreground">
        Teórico: lo que debieron usar las ventas según las recetas (más lo usado en producción). Real: stock al empezar + compras − stock al terminar.
        Sirve entre dos conteos (por ejemplo, de domingo a domingo). La diferencia son mermas sin registrar, porciones más grandes o faltantes.
      </p>
      {!r ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Diferencia total" value={formatMoney(r.totalDifferenceValue)} accent={r.totalDifferenceValue > 0 ? 'text-rose-300' : 'text-emerald-300'}
              sub={r.totalDifferenceValue > 0 ? 'Se usó más de lo que dicen las recetas' : 'Dentro de lo esperado'} />
            {r.byArea.slice(0, 2).map(a => <Stat key={a.area} label={a.area} value={formatMoney(a.value)} />)}
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Insumo</th>
                  <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Sector</th>
                  <th className="px-3 py-2 text-right font-medium">Teórico</th>
                  <th className="px-3 py-2 text-right font-medium">Real</th>
                  <th className="px-3 py-2 text-right font-medium">Diferencia</th>
                  <th className="px-3 py-2 text-right font-medium">$</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.items.map(i => (
                  <tr key={i.id}>
                    <td className="px-3 py-2">{i.name}</td>
                    <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{i.area}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(i.theoretical)} {i.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtQty(i.real)} {i.unit}</td>
                    <td className={cn('px-3 py-2 text-right tabular-nums', i.difference > 0 ? 'text-rose-300' : i.difference < 0 ? 'text-amber-300' : '')}>{fmtQty(i.difference)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(i.differenceValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.warnings.length > 0 && <p className="text-xs text-amber-300">Recetas con líneas que no se pudieron calcular: {r.warnings.join(' · ')}</p>}
        </>
      )}
    </div>
  );
}
