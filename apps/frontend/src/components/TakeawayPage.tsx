// ──────────────────────────────────────────────
// TakeawayPage.tsx — Pedidos para llevar (admin/staff)
// Vista de tarjetas circulares + modal de cobro
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ShoppingBag, Clock, CheckCircle2, XCircle, CreditCard,
  Loader2, Plus, X, RefreshCw,
} from 'lucide-react';
import { useTakeaway } from '../hooks/useTakeaway';
import { takeawayApi, type TakeawayOrder, type TakeawayStatus, type PaymentMethod, ApiError } from '../lib/api';
import { PAYMENT_OPTIONS, PAYMENT_LABEL } from '../lib/menu-helpers';
import { formatMoney } from '../lib/format';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { cn } from '../lib/utils';

const STATUS_STYLE: Record<TakeawayStatus, { text: string; bg: string; border: string; dot: string; label: string }> = {
  OPEN:      { text: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/40',    dot: 'bg-blue-500',    label: 'En preparación' },
  READY:     { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', dot: 'bg-emerald-500', label: 'Listo' },
  PAID:      { text: 'text-muted-foreground', bg: 'bg-secondary/30', border: 'border-border', dot: 'bg-muted-foreground', label: 'Cobrado' },
  CANCELLED: { text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/40',    dot: 'bg-rose-500',    label: 'Cancelado' },
};

// ── Modal de cobro ──
function PayModal({
  order,
  open,
  onClose,
}: { order: TakeawayOrder; open: boolean; onClose: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const total = order.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);

  async function handlePay() {
    const paid = Number(amount);
    if (isNaN(paid) || paid <= 0) { toast.error('Ingresá el monto cobrado'); return; }
    setSubmitting(true);
    try {
      await takeawayApi.pay(order.id, {
        paymentMethod: method,
        amountPaid:    paid,
        notes:         notes.trim() || null,
      });
      toast.success(`Pedido de ${order.customerName} cobrado`);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al cobrar');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-400" />
            Cobrar pedido — {order.customerName}
          </DialogTitle>
          <DialogDescription>
            Confirmá el método de pago y cerrá el pedido
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Detalle de consumo */}
          <div className="rounded-xl border border-border bg-background/50 p-3 space-y-1.5">
            {order.items.map(item => (
              <div key={item.id} className="flex items-start justify-between gap-2 text-sm">
                <span className="flex-1 truncate">{item.itemName}</span>
                <span className="shrink-0 text-muted-foreground">x{item.quantity}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                  {formatMoney(Number(item.price) * item.quantity)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-2 mt-2">
              <span className="text-sm font-semibold">Total a cobrar</span>
              <span className="text-lg font-bold text-emerald-400 tabular-nums">{formatMoney(total)}</span>
            </div>
          </div>

          {/* Método de pago */}
          <div className="space-y-2">
            <Label>Método de pago</Label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_OPTIONS.map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => { setMethod(opt.value as PaymentMethod); setAmount(String(total)); }}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-medium transition-colors',
                    method === opt.value
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                      : 'border-border bg-background/50 hover:bg-secondary/50'
                  )}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Monto */}
          <div className="space-y-2">
            <Label htmlFor="ta-amount">Monto cobrado</Label>
            <Input id="ta-amount" type="number" step="0.01" inputMode="decimal"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onFocus={() => { if (!amount) setAmount(String(total)); }}
              disabled={submitting}
              placeholder={String(total)} />
          </div>

          {/* Vuelto */}
          {Number(amount) > total && (
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Vuelto</span>
              <span className="font-semibold tabular-nums text-emerald-400">
                {formatMoney(Number(amount) - total)}
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="ta-notes">Notas (opcional)</Label>
            <Input id="ta-notes" value={notes} onChange={e => setNotes(e.target.value)}
              disabled={submitting} placeholder="Aclaraciones..." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancelar</Button>
          <Button onClick={handlePay} disabled={submitting || !amount}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar cobro {method === 'CASH' ? 'efectivo' : method === 'CARD' ? 'con tarjeta' : 'por transferencia'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Tarjeta de pedido para llevar ──
function TakeawayCard({ order, onPay }: { order: TakeawayOrder; onPay: () => void }) {
  const [acting, setActing] = useState(false);
  const style = STATUS_STYLE[order.status];
  const total = order.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
  const hora  = new Date(order.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  async function handleReady() {
    setActing(true);
    try {
      await takeawayApi.markReady(order.id);
      toast.success(`Pedido de ${order.customerName} marcado como listo`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    } finally { setActing(false); }
  }

  async function handleCancel() {
    if (!window.confirm(`¿Cancelar pedido de "${order.customerName}"?`)) return;
    setActing(true);
    try {
      await takeawayApi.cancel(order.id);
      toast.success('Pedido cancelado');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    } finally { setActing(false); }
  }

  const isActive = order.status === 'OPEN' || order.status === 'READY';

  return (
    <div className={cn(
      'relative flex flex-col rounded-3xl border p-5 transition-all',
      style.border, style.bg,
      !isActive && 'opacity-60'
    )}>
      {/* Pulse para READY */}
      {order.status === 'READY' && (
        <span className="absolute -top-1 -right-1 flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500" />
        </span>
      )}

      {/* Avatar circular con inicial */}
      <div className="flex items-center gap-3 mb-4">
        <div className={cn(
          'flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 text-xl font-bold',
          style.border, style.text
        )}>
          {order.customerName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="font-semibold truncate">{order.customerName}</p>
          {order.customerPhone && (
            <p className="text-xs text-muted-foreground truncate">{order.customerPhone}</p>
          )}
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
            <span className={cn('text-[10px] font-medium uppercase tracking-wider', style.text)}>
              {style.label}
            </span>
          </div>
        </div>
      </div>

      {/* Items */}
      <div className="flex-1 space-y-1 mb-4">
        {order.items.map(item => (
          <div key={item.id} className="flex items-start justify-between gap-1 text-xs">
            <span className="flex-1 truncate text-foreground/80">
              {item.quantity}x {item.itemName}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatMoney(Number(item.price) * item.quantity)}
            </span>
          </div>
        ))}
        {order.notes && (
          <p className="text-xs italic text-muted-foreground mt-1">📝 {order.notes}</p>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-current/10 pt-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {hora}
          </div>
          <span className={cn('font-bold tabular-nums', style.text)}>
            {formatMoney(total)}
          </span>
        </div>

        {/* Acciones */}
        {isActive && (
          <div className="flex gap-2">
            {order.status === 'OPEN' && (
              <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={handleReady} disabled={acting}>
                {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Listo
              </Button>
            )}
            <Button size="sm" className="flex-1 text-xs" onClick={onPay} disabled={acting}>
              <CreditCard className="h-3 w-3" />
              Cobrar
            </Button>
            <button onClick={handleCancel} disabled={acting}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
              title="Cancelar">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {order.status === 'PAID' && (
          <p className="text-center text-xs text-muted-foreground">
            Cobrado con {PAYMENT_LABEL[order.paymentMethod as PaymentMethod]}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Página principal ──
export function TakeawayPage() {
  const { orders, loading, refresh } = useTakeaway();
  const [filterStatus, setFilterStatus] = useState<TakeawayStatus | 'ACTIVE'>('ACTIVE');
  const [payingOrder, setPayingOrder] = useState<TakeawayOrder | null>(null);

  const filtered = useMemo(() => {
    if (filterStatus === 'ACTIVE') {
      return orders.filter(o => o.status === 'OPEN' || o.status === 'READY');
    }
    return orders.filter(o => o.status === filterStatus);
  }, [orders, filterStatus]);

  const counts = useMemo(() => ({
    ACTIVE:    orders.filter(o => o.status === 'OPEN' || o.status === 'READY').length,
    OPEN:      orders.filter(o => o.status === 'OPEN').length,
    READY:     orders.filter(o => o.status === 'READY').length,
    PAID:      orders.filter(o => o.status === 'PAID').length,
    CANCELLED: orders.filter(o => o.status === 'CANCELLED').length,
  }), [orders]);

  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <span>🥡</span> Para llevar
          </h2>
          <p className="text-sm text-muted-foreground">
            {counts.OPEN} en preparación · {counts.READY} listos
            {counts.PAID > 0 && ` · ${counts.PAID} cobrados hoy`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </Button>
      </div>

      {/* Filtros */}
      <div className="mb-6 flex flex-wrap gap-2">
        {([
          ['ACTIVE', 'Activos', counts.ACTIVE],
          ['OPEN', 'En preparación', counts.OPEN],
          ['READY', 'Listos', counts.READY],
          ['PAID', 'Cobrados', counts.PAID],
          ['CANCELLED', 'Cancelados', counts.CANCELLED],
        ] as const).map(([s, label, count]) => {
          if ((s === 'PAID' || s === 'CANCELLED') && count === 0) return null;
          const active = filterStatus === s;
          return (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                  : 'border-border bg-secondary/50 text-muted-foreground hover:text-foreground'
              )}>
              {label}
              <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', active ? 'bg-emerald-500/20' : 'bg-background/50')}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid de pedidos */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-16 text-center">
          <span className="text-4xl">🥡</span>
          <p className="mt-3 text-sm text-muted-foreground">
            {filterStatus === 'ACTIVE'
              ? 'No hay pedidos para llevar activos ahora'
              : `No hay pedidos en este estado`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map(order => (
            <TakeawayCard
              key={order.id}
              order={order}
              onPay={() => setPayingOrder(order)}
            />
          ))}
        </div>
      )}

      {/* Modal cobro */}
      {payingOrder && (
        <PayModal
          order={payingOrder}
          open={true}
          onClose={() => setPayingOrder(null)}
        />
      )}
    </div>
  );
}
