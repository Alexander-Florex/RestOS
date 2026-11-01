// ──────────────────────────────────────────────
// TakeawayPage.tsx — Pedidos para llevar (admin/staff)
// Vista de tarjetas + modal de cobro + modal de nuevo pedido
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Clock, CheckCircle2, CreditCard,
  Loader2, Plus, X, RefreshCw, ShoppingCart,
  Minus, MessageSquare, Printer, SlidersHorizontal,
} from 'lucide-react';
import { useTakeaway } from '../hooks/useTakeaway';
import { useMenu } from '../hooks/useMenu';
import { takeawayApi, type TakeawayOrder, type TakeawayStatus, type PaymentMethod, type MenuItem, ApiError } from '../lib/api';
import { PAYMENT_OPTIONS, PAYMENT_LABEL } from '../lib/menu-helpers';
import { formatMoney } from '../lib/format';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { PrintButton } from './PrintButton';
import { useConfirm } from './ui/confirm-dialog';
import { useAuth } from '../context/AuthContext';
import { printingApi } from '../lib/api';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { cn } from '../lib/utils';
import { useOrderCart, type CartLine } from '../hooks/useOrderCart';
import { hasOptions, needsChoice, selectionModifiers } from '../lib/modifiers';
import { DishOptionsDialog, type DishChoice } from './DishOptionsDialog';
import { ItemModifiers } from './ItemModifiers';

const STATUS_STYLE: Record<TakeawayStatus, { text: string; bg: string; border: string; dot: string; label: string }> = {
  OPEN:      { text: 'text-sky-400',    bg: 'bg-sky-500/10',    border: 'border-sky-500/40',    dot: 'bg-sky-500',    label: 'En preparación' },
  READY:     { text: 'text-brand-400', bg: 'bg-brand-500/10', border: 'border-brand-500/40', dot: 'bg-brand-500', label: 'Listo' },
  PAID:      { text: 'text-muted-foreground', bg: 'bg-white/[0.04]', border: 'border-border', dot: 'bg-muted-foreground', label: 'Cobrado' },
  CANCELLED: { text: 'text-rose-400',    bg: 'bg-rose-500/10',    border: 'border-rose-500/40',    dot: 'bg-rose-500',    label: 'Cancelado' },
};

// ── Modal de cobro ──────────────────────────────────────────────────────────
function PayModal({ order, open, onClose }: { order: TakeawayOrder; open: boolean; onClose: () => void }) {
  const total = order.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);

  const [method, setMethod]       = useState<PaymentMethod>('CASH');
  // Arranca con el total: el caso común es cobrar justo, sin tener que tipear
  const [amount, setAmount]       = useState(() => String(total));
  const [notes, setNotes]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handlePay() {
    const paid = Number(amount);
    if (isNaN(paid) || paid <= 0) { toast.error('Ingresá el monto cobrado'); return; }
    // Igual que en mesas: no se aceptan cobros parciales (comparación en centavos)
    if (Math.round(paid * 100) < Math.round(total * 100)) {
      toast.error(`El monto cobrado (${formatMoney(paid)}) no cubre el total (${formatMoney(total)})`);
      return;
    }
    setSubmitting(true);
    try {
      await takeawayApi.pay(order.id, { paymentMethod: method, amountPaid: paid, notes: notes.trim() || null });
      toast.success(`Pedido de ${order.customerName} cobrado`);
      // Ticket de caja: igual que en mesas, desde lo guardado y sin elegir impresora
      try {
        await printingApi.printTakeawayReceipt(order.id);
        toast.success('Ticket de caja enviado a imprimir');
      } catch (printErr) {
        toast.error(
          `Pedido cobrado, pero el ticket no se imprimió: ${printErr instanceof ApiError ? printErr.message : 'revisá la impresora'}`,
          { duration: 10_000 },
        );
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error('Este pedido ya fue cobrado o cancelado desde otro dispositivo');
        onClose();
        return;
      }
      toast.error(err instanceof ApiError ? err.message : 'Error al cobrar');
    } finally { setSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-brand-400" />
            Cobrar pedido — {order.customerName}
          </DialogTitle>
          <DialogDescription>Confirmá el método de pago y cerrá el pedido</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 space-y-1.5">
            {order.items.map(item => (
              <div key={item.id} className="flex items-start justify-between gap-2 text-sm">
                <span className="flex-1 min-w-0">
                  <span className="block truncate">{item.itemName}</span>
                  <ItemModifiers className="mt-0.5" modifiers={item.modifiers} notes={item.notes} />
                </span>
                <span className="shrink-0 text-muted-foreground">x{item.quantity}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                  {formatMoney(Number(item.price) * item.quantity)}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-border pt-2 mt-2">
              <span className="text-sm font-semibold">Total a cobrar</span>
              <span className="text-lg font-bold text-brand-400 tabular-nums">{formatMoney(total)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Método de pago</Label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_OPTIONS.map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => { setMethod(opt.value as PaymentMethod); setAmount(String(total)); }}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-medium transition-colors',
                    method === opt.value
                      ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                      : 'border-border bg-white/[0.03] hover:bg-white/[0.06]'
                  )}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ta-amount">Monto cobrado</Label>
            <Input id="ta-amount" type="number" step="0.01" inputMode="decimal"
              value={amount} onChange={e => setAmount(e.target.value)}
              onFocus={() => { if (!amount) setAmount(String(total)); }}
              disabled={submitting} placeholder={String(total)} />
          </div>

          {Number(amount) > total && (
            <div className="flex items-center justify-between rounded-xl border border-brand-500/30 bg-brand-500/5 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Vuelto</span>
              <span className="font-semibold tabular-nums text-brand-400">
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
            Confirmar cobro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Modal de nuevo pedido ───────────────────────────────────────────────────
function NewOrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items: menu, loading: loadingMenu } = useMenu({ onlyEnabled: true });
  const cart = useOrderCart();
  const [customerName, setCustomerName]       = useState('');
  const [customerPhone, setCustomerPhone]     = useState('');
  const [activeCategory, setActiveCategory]   = useState('');
  const [customizing, setCustomizing]         = useState<{ item: MenuItem; line?: CartLine } | null>(null);
  const [submitting, setSubmitting]           = useState(false);

  const categories = useMemo(() => [...new Set(menu.map(i => i.category))], [menu]);
  const effectiveCat = activeCategory || categories[0] || '';
  const filtered = menu.filter(i => i.category === effectiveCat && i.stock !== 'OUT_OF_STOCK');

  function quickAdd(item: MenuItem) {
    if (needsChoice(item)) setCustomizing({ item });
    else cart.add(item);
  }

  function confirmCustomize(choice: DishChoice) {
    if (!customizing) return;
    if (customizing.line) cart.replace(customizing.line.key, customizing.item, choice);
    else cart.add(customizing.item, choice);
    setCustomizing(null);
  }

  function handleClose() {
    setCustomerName('');
    setCustomerPhone('');
    cart.clear();
    setActiveCategory('');
    setCustomizing(null);
    onClose();
  }

  async function handleSubmit() {
    if (!customerName.trim()) { toast.error('Ingresá el nombre del cliente'); return; }
    if (cart.count === 0) { toast.error('Agregá al menos un ítem'); return; }
    setSubmitting(true);
    try {
      await takeawayApi.create({
        customerName:  customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        items: cart.toRequestItems(),
      });
      toast.success(`Pedido para llevar creado — ${customerName.trim()}`);
      handleClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al crear el pedido');
    } finally { setSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && !customizing && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-amber-400" />
            Nuevo pedido para llevar
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Panel izquierdo: menú */}
          <div className="flex flex-col flex-1 overflow-hidden border-r border-border">
            {/* Datos del cliente */}
            <div className="px-4 py-3 border-b border-border space-y-2 shrink-0">
              <Input
                placeholder="Nombre del cliente *"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
              />
              <Input
                placeholder="Teléfono (opcional)"
                value={customerPhone}
                onChange={e => setCustomerPhone(e.target.value)}
              />
            </div>

            {/* Categorías */}
            <div className="flex gap-1.5 overflow-x-auto px-4 py-2 shrink-0 border-b border-border">
              {categories.map(cat => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  className={cn(
                    'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    effectiveCat === cat
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                      : 'border-border bg-white/[0.04] text-muted-foreground hover:text-foreground'
                  )}>
                  {cat}
                </button>
              ))}
            </div>

            {/* Items del menú */}
            <div className="flex-1 overflow-y-auto">
              {loadingMenu ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {filtered.map(item => {
                    const inCart = cart.linesOf(item.id).reduce((s, l) => s + l.quantity, 0);
                    return (
                      <div key={item.id} className="flex items-center gap-2 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{item.name}</p>
                          <p className="text-xs text-brand-400 tabular-nums">{formatMoney(Number(item.price))}</p>
                        </div>
                        {inCart > 0 && (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-300">
                            {inCart}
                          </span>
                        )}
                        <button onClick={() => setCustomizing({ item })}
                          className="flex h-8 items-center gap-1 rounded-full border border-border px-2.5 text-xs text-muted-foreground hover:text-foreground shrink-0"
                          title={hasOptions(item) ? 'Opciones y nota' : 'Agregar con nota'}>
                          {hasOptions(item) ? <SlidersHorizontal className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
                          {hasOptions(item) ? 'Opciones' : 'Nota'}
                        </button>
                        <button onClick={() => quickAdd(item)} aria-label={`Agregar ${item.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-black hover:bg-amber-400 shrink-0">
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Panel derecho: resumen carrito */}
          <div className="w-60 flex flex-col shrink-0">
            <p className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
              Resumen
            </p>
            {cart.count === 0 ? (
              <p className="px-4 py-6 text-xs text-muted-foreground text-center">Sin ítems todavía</p>
            ) : (
              <div className="flex-1 overflow-y-auto divide-y divide-border">
                {cart.lines.map(line => (
                  <div key={line.key} className="px-3 py-2.5 text-xs">
                    <div className="flex items-start justify-between gap-1">
                      <button className="flex-1 truncate text-left font-medium hover:underline"
                        onClick={() => setCustomizing({ item: line.menuItem, line })} title="Editar opciones y nota">
                        {line.menuItem.name}
                      </button>
                      <button onClick={() => cart.adjust(line.key, -line.quantity)} aria-label="Quitar"
                        className="text-muted-foreground hover:text-rose-400 shrink-0">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <ItemModifiers className="mt-1" modifiers={selectionModifiers(line.menuItem, line.optionIds)} notes={line.notes} />
                    <div className="flex items-center justify-between mt-1">
                      <div className="flex items-center gap-1">
                        <button onClick={() => cart.adjust(line.key, -1)} aria-label="Quitar uno"
                          className="flex h-6 w-6 items-center justify-center rounded-full border border-border hover:bg-white/[0.07]">
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="w-5 text-center font-semibold tabular-nums">{line.quantity}</span>
                        <button onClick={() => cart.adjust(line.key, 1)} aria-label="Sumar uno"
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-black hover:bg-amber-400">
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <span className="tabular-nums text-brand-400">{formatMoney(line.unitPrice * line.quantity)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {cart.count > 0 && (
              <div className="border-t border-border px-3 py-2.5 shrink-0">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{cart.count} ítems</span>
                  <span className="font-bold text-brand-400 tabular-nums">{formatMoney(cart.total)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border shrink-0">
          <Button variant="outline" onClick={handleClose} disabled={submitting}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={submitting || cart.count === 0 || !customerName.trim()}
            className="bg-amber-500 hover:bg-amber-400 text-black">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            <ShoppingCart className="h-4 w-4" />
            Crear pedido ({cart.count})
          </Button>
        </DialogFooter>

        {/* Selector anidado dentro del contenido: así el modal de pedido no se cierra */}
        <DishOptionsDialog
          item={customizing?.item ?? null}
          initial={customizing?.line && {
            optionIds: customizing.line.optionIds, notes: customizing.line.notes, quantity: customizing.line.quantity,
          }}
          confirmLabel={customizing?.line ? 'Guardar' : 'Agregar'}
          onClose={() => setCustomizing(null)}
          onConfirm={confirmCustomize}
        />
      </DialogContent>
    </Dialog>
  );
}

// ── Tarjeta de pedido para llevar ───────────────────────────────────────────
function TakeawayCard({ order, onPay }: { order: TakeawayOrder; onPay: () => void }) {
  const confirm = useConfirm();
  const { can } = useAuth();
  const [acting, setActing] = useState(false);
  const style = STATUS_STYLE[order.status];
  const total = order.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
  const hora  = new Date(order.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const isActive = order.status === 'OPEN' || order.status === 'READY';

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
    if (!await confirm({ title: `¿Cancelar pedido de "${order.customerName}"?`, variant: 'destructive', confirmLabel: 'Cancelar pedido', cancelLabel: 'Volver' })) return;
    setActing(true);
    try {
      await takeawayApi.cancel(order.id);
      toast.success('Pedido cancelado');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error');
    } finally { setActing(false); }
  }

  return (
    <div className={cn(
      'relative flex flex-col rounded-3xl border p-5 transition-all',
      style.border, style.bg,
      !isActive && 'opacity-60'
    )}>
      {order.status === 'READY' && (
        <span className="absolute -top-1 -right-1 flex h-4 w-4">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-4 w-4 bg-brand-500" />
        </span>
      )}

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

      <div className="flex-1 space-y-1 mb-4">
        {order.items.map(item => (
          <div key={item.id} className="flex items-start justify-between gap-1 text-xs">
            <span className="flex-1 min-w-0 text-foreground/80">
              <span className="block truncate">{item.quantity}x {item.itemName}</span>
              <ItemModifiers className="mt-0.5" modifiers={item.modifiers} notes={item.notes} />
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

      <div className="border-t border-current/10 pt-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />{hora}
          </div>
          <span className={cn('font-bold tabular-nums', style.text)}>{formatMoney(total)}</span>
        </div>

        {isActive && (
          <div className="flex gap-1.5">
            {/* Imprimir comanda */}
            <PrintButton
              iconOnly
              size="icon"
              variant="outline"
              label="Imprimir comanda"
              className="h-8 w-8 shrink-0"
              onPrint={() => printingApi.printTakeawayOrder(order.id).then(() => {})}
            />
            {order.status === 'OPEN' && (
              <Button variant="outline" size="sm" className="flex-1 text-xs h-8" onClick={handleReady} disabled={acting}>
                {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Listo
              </Button>
            )}
            {can('sales.charge') && (
              <Button size="sm" className="flex-1 text-xs h-8" onClick={onPay} disabled={acting}>
                <CreditCard className="h-3 w-3" />
                Cobrar
              </Button>
            )}
            {can('takeaway.cancel') && (
              <button onClick={handleCancel} disabled={acting} aria-label="Cancelar pedido"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10">
                <X className="h-3 w-3" />
              </button>
            )}
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

// ── Página principal ─────────────────────────────────────────────────────────
export function TakeawayPage() {
  const { orders, loading, refresh } = useTakeaway();
  const [filterStatus, setFilterStatus] = useState<TakeawayStatus | 'ACTIVE'>('ACTIVE');
  const [payingOrder, setPayingOrder]   = useState<TakeawayOrder | null>(null);
  const [newOrderOpen, setNewOrderOpen] = useState(false);

  const filtered = useMemo(() => {
    if (filterStatus === 'ACTIVE') return orders.filter(o => o.status === 'OPEN' || o.status === 'READY');
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
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400"><span className="h-px w-6 bg-gradient-to-r from-brand-400 to-transparent" />Servicio</p>
          <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Para llevar</h2>
          <p className="text-sm text-muted-foreground">
            {counts.OPEN} en preparación · {counts.READY} listos
            {counts.PAID > 0 && ` · ${counts.PAID} cobrados hoy`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </Button>
          <Button size="sm" onClick={() => setNewOrderOpen(true)}
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold">
            <Plus className="h-4 w-4" />
            Nuevo pedido
          </Button>
        </div>
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
                  ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                  : 'border-border bg-white/[0.06] text-muted-foreground hover:text-foreground'
              )}>
              {label}
              <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', active ? 'bg-brand-500/20' : 'bg-white/[0.03]')}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Grid de pedidos */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-16 text-center">
          <span className="text-4xl">🥡</span>
          <p className="mt-3 text-sm text-muted-foreground">
            {filterStatus === 'ACTIVE'
              ? 'No hay pedidos para llevar activos ahora'
              : 'No hay pedidos en este estado'}
          </p>
          {filterStatus === 'ACTIVE' && (
            <Button size="sm" className="mt-4 bg-amber-500 hover:bg-amber-400 text-black"
              onClick={() => setNewOrderOpen(true)}>
              <Plus className="h-4 w-4" />
              Crear primer pedido
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map(order => (
            <TakeawayCard key={order.id} order={order} onPay={() => setPayingOrder(order)} />
          ))}
        </div>
      )}

      {/* Modal cobro */}
      {payingOrder && (
        <PayModal order={payingOrder} open={true} onClose={() => setPayingOrder(null)} />
      )}

      {/* Modal nuevo pedido */}
      <NewOrderModal open={newOrderOpen} onClose={() => setNewOrderOpen(false)} />
    </div>
  );
}
