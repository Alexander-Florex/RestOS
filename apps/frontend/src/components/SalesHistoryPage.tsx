// ──────────────────────────────────────────────
// SalesHistoryPage.tsx — Historial de ventas + stats del día
// ──────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react';
import {
  Banknote, CreditCard, Wallet, Loader2, RefreshCw, Receipt,
  TrendingUp, ImageIcon,
} from 'lucide-react';
import {
  salesApi, type Sale, type PaymentMethod, type DailyStats,
} from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { PAYMENT_LABEL, PAYMENT_OPTIONS } from '../lib/menu-helpers';
import { formatMoney, formatDateTime } from '../lib/format';
import { Button } from './ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from './ui/dialog';
import { cn } from '../lib/utils';

const PAYMENT_ICON: Record<PaymentMethod, typeof Banknote> = {
  CASH: Banknote,
  CARD: CreditCard,
  TRANSFER: Wallet,
};

export function SalesHistoryPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<PaymentMethod | 'ALL'>('ALL');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [list, stats] = await Promise.all([
        salesApi.list(),
        salesApi.dailyStats(),
      ]);
      setSales(list.sales);
      setStats(stats);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // Suscripción: cuando se registra una venta, recargamos todo
  useEffect(() => {
    const socket = getSocket();
    const onNew = () => load();
    socket.on(SocketEvents.SALE_REGISTERED, onNew);
    return () => { socket.off(SocketEvents.SALE_REGISTERED, onNew); };
  }, []);

  const filtered = useMemo(
    () => filter === 'ALL' ? sales : sales.filter(s => s.paymentMethod === filter),
    [sales, filter]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Ventas</h2>
          <p className="text-sm text-muted-foreground">Historial completo + resumen del día</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4" />
          Refrescar
        </Button>
      </div>

      {/* Stats del día */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Hoy"
            value={formatMoney(stats.total)}
            sublabel={`${stats.count} ${stats.count === 1 ? 'venta' : 'ventas'}`}
            icon={TrendingUp}
            highlight
          />
          {PAYMENT_OPTIONS.map(opt => {
            const data = stats.byMethod[opt.value];
            const Icon = PAYMENT_ICON[opt.value];
            return (
              <StatCard
                key={opt.value}
                label={opt.label}
                value={formatMoney(data.amount)}
                sublabel={`${data.count} ${data.count === 1 ? 'venta' : 'ventas'}`}
                icon={Icon}
              />
            );
          })}
        </div>
      )}

      {/* Filtros por método */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setFilter('ALL')}
          className={cn(
            'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
            filter === 'ALL'
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
              : 'border-border bg-secondary/50 text-muted-foreground'
          )}
        >
          Todas · {sales.length}
        </button>
        {PAYMENT_OPTIONS.map(opt => {
          const count = sales.filter(s => s.paymentMethod === opt.value).length;
          return (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                filter === opt.value
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                  : 'border-border bg-secondary/50 text-muted-foreground'
              )}
            >
              {opt.label} · {count}
            </button>
          );
        })}
      </div>

      {/* Tabla de ventas */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No hay ventas {filter !== 'ALL' && `de tipo "${PAYMENT_LABEL[filter as PaymentMethod]}"`} todavía
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border">
          <table className="w-full">
            <thead className="bg-secondary/30 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Fecha</th>
                <th className="px-3 py-2.5 text-left font-medium">Mesa</th>
                <th className="px-3 py-2.5 text-left font-medium">Pago</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
                <th className="px-3 py-2.5 text-right font-medium">Cobrado</th>
                <th className="px-3 py-2.5 text-left font-medium">Notas</th>
                <th className="px-3 py-2.5 text-center font-medium w-12">Comp.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(sale => {
                const Icon = PAYMENT_ICON[sale.paymentMethod];
                return (
                  <tr key={sale.id} className="text-sm hover:bg-secondary/20">
                    <td className="px-3 py-3 text-muted-foreground tabular-nums">
                      {formatDateTime(sale.closedAt)}
                    </td>
                    <td className="px-3 py-3 font-medium tabular-nums">
                      N° {sale.tableNumber}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/50 px-2 py-0.5 text-xs">
                        <Icon className="h-3 w-3" />
                        {PAYMENT_LABEL[sale.paymentMethod]}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatMoney(sale.total)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-semibold text-emerald-400">
                      {formatMoney(sale.amount)}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-3 text-xs text-muted-foreground">
                      {sale.notes ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {sale.imageUrl ? (
                        <button
                          onClick={() => setPreviewImage(sale.imageUrl)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-400 hover:bg-emerald-500/10"
                          title="Ver comprobante"
                        >
                          <ImageIcon className="h-4 w-4" />
                        </button>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de preview de comprobante */}
      <Dialog open={previewImage !== null} onOpenChange={(v) => !v && setPreviewImage(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              Comprobante
            </DialogTitle>
          </DialogHeader>
          {previewImage && (
            <img
              src={previewImage}
              alt="Comprobante"
              className="max-h-[70vh] w-full rounded-xl border border-border object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label, value, sublabel, icon: Icon, highlight,
}: {
  label: string;
  value: string;
  sublabel: string;
  icon: typeof TrendingUp;
  highlight?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-2xl border bg-card p-4 transition-colors',
      highlight ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border'
    )}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', highlight ? 'text-emerald-400' : 'text-muted-foreground')} />
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
      <p className={cn(
        'mt-2 text-xl font-bold tabular-nums',
        highlight ? 'text-emerald-400' : 'text-foreground'
      )}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{sublabel}</p>
    </div>
  );
}
