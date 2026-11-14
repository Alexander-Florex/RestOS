// ──────────────────────────────────────────────
// CloseTableModal.tsx — Flujo de cierre + venta
// ──────────────────────────────────────────────
import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  CreditCard, Loader2, Banknote, Image as ImageIcon, X, ArrowLeft, NotebookPen, Split,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Select } from './ui/select';
import {
  salesApi, printingApi, accountsApi, cashApi, type Order, type PaymentMethod, type Table, type AccountCustomer, type CashPromo, ApiError,
} from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { PAYMENT_OPTIONS, PAYMENT_LABEL } from '../lib/menu-helpers';
import { formatMoney } from '../lib/format';
import { cn } from '../lib/utils';
import { ItemModifiers } from './ItemModifiers';
import { tableLabel, tablesLabel } from '../lib/table-label';

interface CloseTableModalProps {
  table: Table;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  orders: Order[];
  total: number;
  /** Mesas unidas (tarea 5.3): todas las del grupo, sus pedidos y el total del grupo */
  group?: { tables: Table[]; orders: Order[]; total: number } | null;
}

// Convierte File → base64 (con prefijo data:)
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

export function CloseTableModal({
  table, open, onClose, onSuccess, orders: ownOrders, total: ownTotal, group,
}: CloseTableModalProps) {
  // Mesas unidas: por defecto se cobra todo junto; se puede cobrar solo esta mesa
  const [whole, setWhole] = useState(true);
  const isWhole = !!group && whole;
  const orders = isWhole ? group!.orders : ownOrders;
  // Lo consumido; lo que se cobra es esto menos el descuento (tarea 5.2)
  const subtotal = isWhole ? group!.total : ownTotal;
  const label = isWhole ? tablesLabel(group!.tables) : tableLabel(table);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Cuenta corriente (tarea 5.9): solo quien tiene "Cuentas corrientes" (Caja y Administrador)
  const { can } = useAuth();
  const canAccount = can('accounts.manage');
  const [customers, setCustomers] = useState<AccountCustomer[]>([]);
  const [customerId, setCustomerId] = useState('');
  const isAccount = paymentMethod === 'ACCOUNT';

  // Descuento con motivo (permiso "Hacer descuentos") y promo de efectivo
  const canDiscount = can('sales.discount');
  const [discountOn, setDiscountOn] = useState(false);
  const [discountPct, setDiscountPct] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [promo, setPromo] = useState<CashPromo | null>(null);
  const pctNum = Number(discountPct.replace(',', '.'));
  const pctValid = !discountOn || (Number.isFinite(pctNum) && pctNum > 0 && pctNum <= 100);
  const subtotalCents = Math.round(subtotal * 100);
  const discountCentsV = discountOn && pctValid ? Math.round((subtotalCents * Math.round(pctNum * 100)) / 10_000) : 0;
  const total = (subtotalCents - discountCentsV) / 100;

  // Varios medios o cuenta dividida entre comensales
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState<Array<{ method: 'CASH' | 'CARD' | 'TRANSFER'; amount: string }>>([]);
  const partsCents = parts.map(p => Math.round(Number(p.amount.replace(',', '.')) * 100) || 0);
  const nonCashCents = parts.reduce((s, p, i) => s + (p.method === 'CASH' ? 0 : partsCents[i]), 0);
  const cashCents = parts.reduce((s, p, i) => s + (p.method === 'CASH' ? partsCents[i] : 0), 0);
  const totalCents = Math.round(total * 100);
  const missingCents = Math.max(0, totalCents - nonCashCents - cashCents);
  const splitChangeCents = Math.max(0, cashCents - Math.max(0, totalCents - nonCashCents));
  function splitEqually(n: number) {
    const count = Math.max(2, Math.min(20, Math.floor(n)));
    const base = Math.floor(totalCents / count);
    setParts(Array.from({ length: count }, (_, i) => ({
      method: parts[i]?.method ?? 'CASH',
      amount: ((i === count - 1 ? totalCents - base * (count - 1) : base) / 100).toFixed(2),
    })));
  }
  useEffect(() => {
    if (!open) return;
    setDiscountOn(false); setDiscountPct(''); setDiscountReason(''); setSplit(false); setParts([]);
    cashApi.promo().then(setPromo).catch(() => setPromo(null));
  }, [open]);
  useEffect(() => {
    if (!open || !canAccount) return;
    setCustomerId('');
    accountsApi.list().then(r => setCustomers(r.customers)).catch(() => setCustomers([]));
  }, [open, canAccount]);

  // Al abrir, autocompletamos amount = total
  useEffect(() => {
    if (open) setWhole(true);
  }, [open]);

  useEffect(() => {
    if (open) {
      setPaymentMethod('CASH');
      setAmount(total > 0 ? total.toFixed(2) : '');
      setNotes('');
      setImageBase64(null);
      setImagePreview(null);
    }
  }, [open, total]);

  const change = Number(amount) - total;
  const promoSuggested = !!promo?.activeToday && !!promo.pct && canDiscount && !isAccount && !discountOn
    && (split ? parts.every(p => p.method === 'CASH') : paymentMethod === 'CASH');
  // Los platos cambiados no se cobran (tarea 5.8)
  const items = orders.flatMap(o => o.items).filter(i => i.status !== 'VOIDED');

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('El archivo debe ser una imagen');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('La imagen no puede pesar más de 8MB');
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      setImageBase64(base64);
      setImagePreview(base64);
    } catch {
      toast.error('No se pudo leer la imagen');
    }
  }

  async function handleSubmit() {
    // A cuenta (tarea 5.9): no entra plata; hay que elegir el cliente
    const customer = customers.find(c => String(c.id) === customerId);
    if (isAccount && !customer) {
      toast.error('Elegí a cuenta de qué cliente queda');
      return;
    }
    if (discountOn && (!pctValid || discountReason.trim().length < 3)) {
      toast.error('Completá el descuento: porcentaje entre 1 y 100 y el motivo');
      return;
    }
    if (split && !isAccount) {
      if (parts.length === 0 || partsCents.some(c => c <= 0)) { toast.error('Cada parte tiene que tener un monto'); return; }
      if (nonCashCents > totalCents) { toast.error('Con tarjeta o transferencia no se puede pagar de más'); return; }
      if (missingCents > 0) { toast.error(`Falta cobrar ${formatMoney(missingCents / 100)}`); return; }
    }
    const numericAmount = isAccount ? 0 : split ? (nonCashCents + cashCents) / 100 : Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount < 0) {
      toast.error('Ingresá un monto válido');
      return;
    }
    // No se aceptan cobros parciales (el backend también lo rechaza). Comparamos en centavos.
    if (!isAccount && !split && Math.round(numericAmount * 100) < Math.round(total * 100)) {
      toast.error(`El monto cobrado (${formatMoney(numericAmount)}) no cubre el total (${formatMoney(total)})`);
      return;
    }

    setSubmitting(true);
    try {
      const { sale } = await salesApi.create({
        tableId: table.id,
        wholeGroup: isWhole,
        ...(split && !isAccount
          ? { payments: parts.map((p, i) => ({ method: p.method, amount: partsCents[i] / 100 })) }
          : { paymentMethod, amount: numericAmount }),
        ...(isAccount ? { customerId: customer!.id } : {}),
        ...(discountOn ? { discountPct: pctNum, discountReason: discountReason.trim() } : {}),
        notes: notes.trim() || undefined,
        imageBase64: imageBase64 || undefined,
      });
      toast.success(isAccount
        ? `${label}: ${formatMoney(total)} a cuenta de ${customer!.name}`
        : `${label} ${isWhole ? 'cobradas' : 'cobrada'}: ${formatMoney(numericAmount)}`);

      // Ticket de caja: siempre, desde la venta guardada. Imprime el agente local,
      // no depende de que este dispositivo tenga una impresora elegida.
      try {
        await printingApi.printSale(sale.id);
        toast.success('Ticket de caja enviado a imprimir');
      } catch (printErr) {
        toast.error(
          `Venta registrada, pero el ticket no se imprimió: ${printErr instanceof ApiError ? printErr.message : 'revisá la impresora'}`,
          { duration: 10_000 },
        );
      }

      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Otro dispositivo ya cobró esta mesa: cerramos el modal y refrescamos
        toast.error(isWhole ? 'Alguna de las mesas ya se cobró desde otro dispositivo. Revisá la cuenta.' : `${label} ya fue cobrada desde otro dispositivo`);
        onSuccess();
        return;
      }
      toast.error(err instanceof ApiError ? err.message : 'Error al cobrar la mesa');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-brand-400" />
            Cobrar {label}
          </DialogTitle>
          <DialogDescription>
            Revisá el desglose y confirmá el cobro. Al hacerlo, {isWhole ? 'las mesas quedarán libres' : 'la mesa quedará libre'}.
          </DialogDescription>
        </DialogHeader>

        {/* Mesas unidas: cobrar todo junto o solo esta mesa */}
        {group && (
          <div className="grid grid-cols-2 gap-2">
            {([[true, `Todo junto · ${formatMoney(group.total)}`, tablesLabel(group.tables)], [false, `Solo esta mesa · ${formatMoney(ownTotal)}`, tableLabel(table)]] as const).map(([v, title, sub]) => (
              <button key={String(v)} type="button" disabled={submitting} onClick={() => setWhole(v)}
                className={cn('rounded-xl border-2 px-3 py-2 text-left text-sm transition-colors',
                  whole === v ? 'border-brand-500/50 bg-brand-500/10 text-brand-300' : 'border-border text-muted-foreground hover:text-foreground')}>
                <span className="block font-semibold">{title}</span>
                <span className="block truncate text-xs">{sub}</span>
              </button>
            ))}
          </div>
        )}

        {/* Desglose */}
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
          <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Detalle de consumo
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {items.map((item) => (
              <div key={item.id} className="flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate">
                    {item.itemName} <span className="text-muted-foreground">x{item.quantity}</span>
                  </span>
                  {/* Los agregados explican el precio de la línea */}
                  <ItemModifiers className="mt-0.5" modifiers={item.modifiers} />
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatMoney(Number(item.price) * item.quantity)}
                </span>
              </div>
            ))}
          </div>
          {discountCentsV > 0 && (
            <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span className="tabular-nums">{formatMoney(subtotal)}</span></div>
              <div className="flex justify-between text-emerald-300"><span>Descuento {pctNum}%{discountReason.trim() ? ` · ${discountReason.trim()}` : ''}</span><span className="tabular-nums">−{formatMoney(discountCentsV / 100)}</span></div>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-semibold">Total a cobrar</span>
            <span className="text-2xl font-bold text-brand-400 tabular-nums">
              {formatMoney(total)}
            </span>
          </div>
        </div>

        {/* Form de cobro */}
        <div className="mt-4 space-y-4">
          {/* Método de pago: como botones grandes */}
          <div className="space-y-2">
            <Label>Método de pago</Label>
            <div className={cn('grid gap-2', canAccount ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4')}>
              {[...PAYMENT_OPTIONS, ...(canAccount ? [{ value: 'ACCOUNT' as PaymentMethod, label: 'A cuenta' }] : [])].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => { setPaymentMethod(opt.value); setSplit(false); }}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition-colors',
                    !split && paymentMethod === opt.value
                      ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                      : 'border-border bg-white/[0.04] text-muted-foreground hover:border-foreground/30'
                  )}
                >
                  {opt.value === 'CASH' && <Banknote className="h-4 w-4" />}
                  {opt.value === 'CARD' && <CreditCard className="h-4 w-4" />}
                  {opt.value === 'ACCOUNT' && <NotebookPen className="h-4 w-4" />}
                  {opt.label}
                </button>
              ))}
              {/* Varios medios o cuenta dividida entre comensales */}
              <button type="button" disabled={submitting}
                onClick={() => {
                  setSplit(true); setPaymentMethod('CASH');
                  if (parts.length === 0) setParts([{ method: 'CASH', amount: total.toFixed(2) }]);
                }}
                className={cn('flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  split ? 'border-sky-400/50 bg-sky-500/10 text-sky-300' : 'border-border bg-white/[0.04] text-muted-foreground hover:border-foreground/30')}>
                <Split className="h-4 w-4" /> Dividir
              </button>
            </div>
          </div>

          {/* Dividir la cuenta o pagar con varios medios */}
          {split && (
            <div className="space-y-2 rounded-2xl border border-sky-400/30 bg-sky-500/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Partes del pago</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  Dividir en
                  {[2, 3, 4, 5, 6].map(n => (
                    <button key={n} type="button" onClick={() => splitEqually(n)} disabled={submitting}
                      className="rounded-md border border-border px-2 py-0.5 font-medium hover:border-sky-400/50">{n}</button>
                  ))}
                </span>
              </div>
              {parts.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={p.method} disabled={submitting} className="w-36"
                    onChange={(e) => setParts(ps => ps.map((x, j) => j === i ? { ...x, method: e.target.value as 'CASH' | 'CARD' | 'TRANSFER' } : x))}>
                    {PAYMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                  <Input type="number" step="0.01" inputMode="decimal" value={p.amount} disabled={submitting} className="tabular-nums"
                    onChange={(e) => setParts(ps => ps.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                  <button type="button" onClick={() => setParts(ps => ps.filter((_, j) => j !== i))} disabled={submitting || parts.length === 1}
                    className="rounded-lg p-2 text-muted-foreground hover:text-rose-300 disabled:opacity-30" aria-label="Quitar parte">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between text-sm">
                <button type="button" disabled={submitting} className="text-sky-300 hover:underline"
                  onClick={() => setParts(ps => [...ps, { method: 'CARD', amount: (missingCents / 100).toFixed(2) }])}>
                  + Agregar parte
                </button>
                <span className={cn('font-medium', missingCents > 0 ? 'text-rose-300' : 'text-emerald-300')}>
                  {missingCents > 0 ? `Falta ${formatMoney(missingCents / 100)}` : splitChangeCents > 0 ? `Vuelto ${formatMoney(splitChangeCents / 100)}` : 'Cubre el total'}
                </span>
              </div>
              {nonCashCents > totalCents && <p className="text-xs text-rose-300">Con tarjeta o transferencia no se puede pagar de más.</p>}
            </div>
          )}

          {/* Descuento con motivo; la promo de efectivo se sugiere esos días */}
          {canDiscount && (
            <div className="space-y-2">
              {promoSuggested && (
                <button type="button" disabled={submitting}
                  onClick={() => { setDiscountOn(true); setDiscountPct(String(promo!.pct)); setDiscountReason('Promo efectivo'); }}
                  className="w-full rounded-xl border-2 border-dashed border-emerald-400/40 bg-emerald-500/5 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/10">
                  Hoy hay promo: aplicar {promo!.pct}% pagando en efectivo
                </button>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={discountOn} disabled={submitting}
                  onChange={(e) => { setDiscountOn(e.target.checked); if (!e.target.checked) { setDiscountPct(''); setDiscountReason(''); } }} />
                Descuento
              </label>
              {discountOn && (
                <div className="grid grid-cols-3 gap-2">
                  <Input inputMode="decimal" placeholder="%" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} disabled={submitting} />
                  <Input className="col-span-2" maxLength={200} placeholder="Motivo (obligatorio)" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} disabled={submitting} />
                </div>
              )}
            </div>
          )}

          {/* A cuenta: de qué cliente (Municipalidad, cooperativa) */}
          {isAccount && (
            <div className="space-y-2">
              <Label htmlFor="accCustomer">A cuenta de</Label>
              <Select id="accCustomer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={submitting}>
                <option value="">Elegí el cliente…</option>
                {customers.filter(c => c.active).map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.balance > 0 ? ` (debe ${formatMoney(c.balance)})` : ''}</option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                No entra plata: la mesa se libera y queda como deuda. Pedí que firmen la comanda.
                {customers.filter(c => c.active).length === 0 && ' No hay clientes con cuenta: cargalos en "Cuentas corrientes".'}
              </p>
            </div>
          )}

          {/* Monto cobrado */}
          {!isAccount && !split && <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Monto cobrado</Label>
              {paymentMethod === 'CASH' && change > 0 && (
                <span className="text-xs text-brand-400">
                  Vuelto: {formatMoney(change)}
                </span>
              )}
            </div>
            <Input
              id="amount"
              type="number"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={submitting}
              className="tabular-nums text-lg"
            />
          </div>}

          {/* Notas */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              placeholder="Aclaraciones sobre la venta..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
              maxLength={500}
            />
          </div>

          {/* Comprobante */}
          <div className="space-y-2">
            <Label>Comprobante (opcional)</Label>
            {imagePreview ? (
              <div className="relative">
                <img
                  src={imagePreview}
                  alt="Comprobante"
                  className="h-32 w-full rounded-xl border border-border object-cover"
                />
                <button
                  type="button"
                  onClick={() => { setImageBase64(null); setImagePreview(null); }}
                  className="absolute top-2 right-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
                  aria-label="Quitar imagen"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting}
                className="flex h-24 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/10 bg-white/[0.025] text-sm text-muted-foreground hover:border-brand-500/40 hover:text-foreground transition-colors"
              >
                <ImageIcon className="h-4 w-4" />
                Subir imagen del comprobante
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = ''; // permitir re-elegir mismo archivo
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || items.length === 0}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isAccount ? 'Dejar a cuenta' : split ? `Confirmar cobro (${parts.length} ${parts.length === 1 ? 'parte' : 'partes'})` : `Confirmar cobro ${PAYMENT_LABEL[paymentMethod].toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
