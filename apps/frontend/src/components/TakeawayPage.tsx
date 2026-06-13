// ──────────────────────────────────────────────
// TakeawayPage.tsx — Pedidos para llevar (admin/staff)
// Vista de tarjetas + modal de cobro + modal de nuevo pedido
// ──────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Clock, CheckCircle2, CreditCard,
  Loader2, Plus, X, RefreshCw, ShoppingCart,
  Minus, MessageSquare, Printer,
} from 'lucide-react';
import { useTakeaway } from '../hooks/useTakeaway';
import { useMenu } from '../hooks/useMenu';
import { takeawayApi, type TakeawayOrder, type TakeawayStatus, type PaymentMethod, type MenuItem, ApiError } from '../lib/api';
import { PAYMENT_OPTIONS, PAYMENT_LABEL } from '../lib/menu-helpers';
import { formatMoney } from '../lib/format';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { PrintButton, printerPrefs } from './PrintButton';
import { printingApi } from '../lib/api';
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

// ── Modal de cobro ──────────────────────────────────────────────────────────
function PayModal({ order, open, onClose }: { order: TakeawayOrder; open: boolean; onClose: () => void }) {
  const [method, setMethod]       = useState<PaymentMethod>('CASH');
  const [amount, setAmount]       = useState('');
  const [notes, setNotes]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  const total = order.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);

  async function handlePay() {
    const paid = Number(amount);
    if (isNaN(paid) || paid <= 0) { toast.error('Ingresá el monto cobrado'); return; }
    setSubmitting(true);
    try {
      await takeawayApi.pay(order.id, { paymentMethod: method, amountPaid: paid, notes: notes.trim() || null });
      toast.success(`Pedido de ${order.customerName} cobrado`);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al cobrar');
    } finally { setSubmitting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-400" />
            Cobrar pedido — {order.customerName}
          </DialogTitle>
          <DialogDescription>Confirmá el método de pago y cerrá el pedido</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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

          <div className="space-y-2">
            <Label htmlFor="ta-amount">Monto cobrado</Label>
            <Input id="ta-amount" type="number" step="0.01" inputMode="decimal"
              value={amount} onChange={e => setAmount(e.target.value)}
              onFocus={() => { if (!amount) setAmount(String(total)); }}
              disabled={submitting} placeholder={String(total)} />
          </div>

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
            Confirmar cobro
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Modal de nuevo pedido ───────────────────────────────────────────────────
type CartItem = { menuItem: MenuItem; quantity: number; notes: string };

function NewOrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items: menu, loading: loadingMenu } = useMenu({ onlyEnabled: true });
  const [customerName, setCustomerName]       = useState('');
  const [customerPhone, setCustomerPhone]     = useState('');
  const [cart, setCart]                       = useState<Map<number, CartItem>>(new Map());
  const [activeCategory, setActiveCategory]   = useState('');
  const [noteModal, setNoteModal]             = useState<CartItem | null>(null);
  const [noteText, setNoteText]               = useState('');
  const [submitting, setSubmitting]           = useState(false);

  const categories = useMemo(() => [...new Set(menu.map(i => i.category))], [menu]);
  const effectiveCat = activeCategory || categories[0] || '';
  const filtered = menu.filter(i => i.category === effectiveCat);

  const cartCount = useMemo(() => Array.from(cart.values()).reduce((s, i) => s + i.quantity, 0), [cart]);
  const cartTotal = useMemo(() => Array.from(cart.values()).reduce((s, i) => s + Number(i.menuItem.price) * i.quantity, 0), [cart]);

  function adjust(item: MenuItem, delta: number) {
    setCart(prev => {
      const next = new Map(prev);
      const cur  = next.get(item.id);
      const newQ = (cur?.quantity ?? 0) + delta;
      if (newQ <= 0) next.delete(item.id);
      else next.set(item.id, { menuItem: item, quantity: newQ, notes: cur?.notes ?? '' });
      return next;
    });
  }

  function openNote(ci: CartItem) {
    setNoteModal(ci);
    setNoteText(ci.notes);
  }

  function saveNote() {
    if (!noteModal) return;
    setCart(prev => {
      const next = new Map(prev);
      const cur  = next.get(noteModal.menuItem.id);
      if (cur) next.set(noteModal.menuItem.id, { ...cur, notes: noteText });
      return next;
    });
    setNoteModal(null);
    setNoteText('');
  }

  function handleClose() {
    setCustomerName('');
    setCustomerPhone('');
    setCart(new Map());
    setActiveCategory('');
    onClose();
  }

  async function handleSubmit() {
    if (!customerName.trim()) { toast.error('Ingresá el nombre del cliente'); return; }
    if (cart.size === 0) { toast.error('Agregá al menos un ítem'); return; }
    setSubmitting(true);
    try {
      await takeawayApi.create({
        customerName:  customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        items: Array.from(cart.values()).map(ci => ({
          menuItemId: ci.menuItem.id,
          quantity:   ci.quantity,
          notes:      ci.notes || undefined,
        })),
      });
      toast.success(`Pedido para llevar creado — ${customerName.trim()}`);
      handleClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al crear el pedido');
    } finally { setSubmitting(false); }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={v => !v && handleClose()}>
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
                        : 'border-border bg-secondary/30 text-muted-foreground hover:text-foreground'
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
                      const inCart = cart.get(item.id);
                      return (
                        <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.name}</p>
                            <p className="text-xs text-emerald-400 tabular-nums">{formatMoney(Number(item.price))}</p>
                          </div>
                          {inCart ? (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button onClick={() => openNote(inCart)}
                                className="rounded-md p-1 text-muted-foreground hover:text-foreground"
                                title="Nota">
                                <MessageSquare className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => adjust(item, -1)}
                                className="flex h-7 w-7 items-center justify-center rounded-full border border-border hover:bg-secondary/60">
                                <Minus className="h-3 w-3" />
                              </button>
                              <span className="w-5 text-center text-sm font-semibold tabular-nums">{inCart.quantity}</span>
                              <button onClick={() => adjust(item, 1)}
                                className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-black hover:bg-amber-400">
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => adjust(item, 1)}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-black hover:bg-amber-400 shrink-0">
                              <Plus className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Panel derecho: resumen carrito */}
            <div className="w-56 flex flex-col shrink-0">
              <p className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                Resumen
              </p>
              {cart.size === 0 ? (
                <p className="px-4 py-6 text-xs text-muted-foreground text-center">Sin ítems todavía</p>
              ) : (
                <div className="flex-1 overflow-y-auto divide-y divide-border">
                  {Array.from(cart.values()).map(ci => (
                    <div key={ci.menuItem.id} className="px-3 py-2.5 text-xs">
                      <div className="flex items-start justify-between gap-1">
                        <span className="flex-1 truncate font-medium">{ci.menuItem.name}</span>
                        <button onClick={() => adjust(ci.menuItem, -ci.quantity)}
                          className="text-muted-foreground hover:text-rose-400 shrink-0">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-muted-foreground">x{ci.quantity}</span>
                        <span className="tabular-nums text-emerald-400">
                          {formatMoney(Number(ci.menuItem.price) * ci.quantity)}
                        </span>
                      </div>
                      {ci.notes && (
                        <p className="text-muted-foreground italic mt-0.5 truncate">📝 {ci.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {cart.size > 0 && (
                <div className="border-t border-border px-3 py-2.5 shrink-0">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">{cartCount} ítems</span>
                    <span className="font-bold text-emerald-400 tabular-nums">{formatMoney(cartTotal)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border shrink-0">
            <Button variant="outline" onClick={handleClose} disabled={submitting}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={submitting || cart.size === 0 || !customerName.trim()}
              className="bg-amber-500 hover:bg-amber-400 text-black">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <ShoppingCart className="h-4 w-4" />
              Crear pedido ({cartCount})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal nota del ítem */}
      <Dialog open={!!noteModal} onOpenChange={v => !v && setNoteModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Nota para {noteModal?.menuItem.name}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Ej: sin sal, bien cocido..."
            value={noteText}
            onChange={e => setNoteText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveNote(); }}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNoteModal(null)}>Cancelar</Button>
            <Button size="sm" onClick={saveNote}>Guardar nota</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Tarjeta de pedido para llevar ───────────────────────────────────────────
function TakeawayCard({ order, onPay }: { order: TakeawayOrder; onPay: () => void }) {
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
    if (!window.confirm(`¿Cancelar pedido de "${order.customerName}"?`)) return;
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
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500" />
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
            <span className="flex-1 truncate text-foreground/80">{item.quantity}x {item.itemName}</span>
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
              onPrint={(printerName, restaurantName) =>
                printingApi.printTakeawayOrder(order.id, { printerName, restaurantName }).then(() => {})
              }
            />
            {order.status === 'OPEN' && (
              <Button variant="outline" size="sm" className="flex-1 text-xs h-8" onClick={handleReady} disabled={acting}>
                {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Listo
              </Button>
            )}
            <Button size="sm" className="flex-1 text-xs h-8" onClick={onPay} disabled={acting}>
              <CreditCard className="h-3 w-3" />
              Cobrar
            </Button>
            <button onClick={handleCancel} disabled={acting}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10">
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
