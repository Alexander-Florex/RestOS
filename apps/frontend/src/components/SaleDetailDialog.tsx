// ──────────────────────────────────────────────
// SaleDetailDialog.tsx — Qué se pidió y cómo se cobró una mesa ya cerrada.
// Solo lectura; se abre desde Inicio, Ventas y Reportes.
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { Loader2, Printer, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, printingApi, salesApi, type SaleDetail } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { PAYMENT_LABEL } from '../lib/menu-helpers';
import { formatDateTimeLong, formatMoney, saleOriginLabel } from '../lib/format';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { ItemModifiers } from './ItemModifiers';
import { cn } from '../lib/utils';

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

export function SaleDetailDialog({ saleId, onClose }: { saleId: number | null; onClose: () => void }) {
  const { can } = useAuth();
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (saleId === null) return;
    let current = true;
    setSale(null);
    setError(null);
    salesApi.detail(saleId)
      .then(r => { if (current) setSale(r.sale); })
      .catch(err => { if (current) setError(err instanceof ApiError ? err.message : 'No se pudo abrir la venta'); });
    return () => { current = false; };
  }, [saleId]);

  async function reprint() {
    if (!sale) return;
    setPrinting(true);
    try {
      await printingApi.printSale(sale.id);
      toast.success('Ticket enviado a imprimir');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo imprimir el ticket');
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Dialog open={saleId !== null} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-brand-400" />
            {sale ? saleOriginLabel(sale) : 'Venta'}{saleId !== null ? ` · #${saleId}` : ''}
          </DialogTitle>
          <DialogDescription>
            {sale
              ? `Cobrada el ${formatDateTimeLong(sale.closedAt)}${sale.registeredByName ? ` por ${sale.registeredByName}` : ''}`
              : 'Detalle de la venta'}
          </DialogDescription>
        </DialogHeader>

        {error && <p className="py-6 text-center text-sm text-rose-300">{error}</p>}
        {!sale && !error && (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        )}

        {sale && (
          <div className="space-y-4">
            {sale.orders.length > 0 ? (
              sale.orders.map((order, index) => (
                <section key={order.id} className="rounded-2xl border border-border p-3">
                  <p className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold uppercase tracking-wider">Pedido {index + 1} · {timeOf(order.createdAt)} hs</span>
                    {order.waiterName && <span>Mozo: {order.waiterName}</span>}
                  </p>
                  <ul className="space-y-1.5 text-sm">
                    {order.items.map(item => {
                      const voided = item.status === 'VOIDED';
                      return (
                        <li key={item.id} className="flex justify-between gap-3">
                          <span className="min-w-0">
                            <span className={cn(voided && 'text-muted-foreground line-through')}>{item.quantity}x {item.itemName}</span>
                            <ItemModifiers className="mt-0.5" modifiers={item.modifiers} notes={item.notes} />
                            {voided && <span className="block text-xs text-rose-300">No se cobró{item.voidReason ? `: ${item.voidReason}` : ''}</span>}
                          </span>
                          <span className={cn('shrink-0 tabular-nums text-muted-foreground', voided && 'line-through')}>
                            {formatMoney(item.price * item.quantity)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {order.notes && <p className="mt-2 text-xs text-muted-foreground">Nota: {order.notes}</p>}
                </section>
              ))
            ) : (
              <section className="rounded-2xl border border-border p-3">
                <ul className="space-y-1.5 text-sm">
                  {sale.items.map(item => (
                    <li key={item.id} className="flex justify-between gap-3">
                      <span className="min-w-0">
                        {item.quantity}x {item.itemName}
                        <ItemModifiers className="mt-0.5" modifiers={item.modifiers} />
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{formatMoney(item.subtotal)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-1 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 text-sm">
              {sale.discount > 0 && (
                <>
                  <Row label="Subtotal" value={formatMoney(sale.subtotal ?? sale.total + sale.discount)} />
                  <Row
                    className="text-emerald-300"
                    label={`Descuento${sale.discountPct ? ` ${sale.discountPct}%` : ''}${sale.discountReason ? ` · ${sale.discountReason}` : ''}`}
                    value={`−${formatMoney(sale.discount)}`}
                  />
                </>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="font-semibold">Total</span>
                <span className="text-xl font-bold tabular-nums text-brand-400">{formatMoney(sale.total)}</span>
              </div>
              <div className="mt-2 space-y-1 border-t border-border pt-2">
                {sale.payments.length > 0 ? sale.payments.map((p, i) => (
                  <div key={i}>
                    <Row label={PAYMENT_LABEL[p.method]} value={formatMoney(p.amount)} />
                    {p.tendered !== null && p.tendered > p.amount && (
                      <Row className="text-xs text-muted-foreground" label={`Entregó ${formatMoney(p.tendered)}`} value={`Vuelto ${formatMoney(p.tendered - p.amount)}`} />
                    )}
                  </div>
                )) : <Row label={PAYMENT_LABEL[sale.paymentMethod]} value={formatMoney(sale.total)} />}
              </div>
              {sale.notes && <p className="border-t border-border pt-2 text-xs text-muted-foreground">Nota: {sale.notes}</p>}
            </section>

            {can('sales.charge') && (
              <Button variant="outline" className="w-full" onClick={reprint} disabled={printing}>
                {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                Reimprimir ticket
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex justify-between gap-3', className)}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}
