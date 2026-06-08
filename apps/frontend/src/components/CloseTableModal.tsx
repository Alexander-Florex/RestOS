// ──────────────────────────────────────────────
// CloseTableModal.tsx — Flujo de cierre + venta
// ──────────────────────────────────────────────
import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  CreditCard, Loader2, Banknote, Image as ImageIcon, X, ArrowLeft,
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
  salesApi, type Order, type PaymentMethod, type Table, ApiError,
} from '../lib/api';
import { PAYMENT_OPTIONS, PAYMENT_LABEL } from '../lib/menu-helpers';
import { formatMoney } from '../lib/format';
import { cn } from '../lib/utils';

interface CloseTableModalProps {
  table: Table;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  orders: Order[];
  total: number;
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
  table, open, onClose, onSuccess, orders, total,
}: CloseTableModalProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Al abrir, autocompletamos amount = total
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
  const items = orders.flatMap(o => o.items);

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
    const numericAmount = Number(amount);
    if (Number.isNaN(numericAmount) || numericAmount < 0) {
      toast.error('Ingresá un monto válido');
      return;
    }
    if (numericAmount < total) {
      const proceed = window.confirm(
        `El monto cobrado (${formatMoney(numericAmount)}) es menor al total (${formatMoney(total)}). ¿Confirmás de todos modos?`
      );
      if (!proceed) return;
    }

    setSubmitting(true);
    try {
      await salesApi.create({
        tableId: table.id,
        paymentMethod,
        amount: numericAmount,
        notes: notes.trim() || undefined,
        imageBase64: imageBase64 || undefined,
      });
      toast.success(`Mesa ${table.number} cobrada: ${formatMoney(numericAmount)}`);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Error al cobrar la mesa');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-400" />
            Cobrar mesa N° {table.number}
          </DialogTitle>
          <DialogDescription>
            Revisá el desglose y confirmá el cobro. Al hacerlo, la mesa quedará libre.
          </DialogDescription>
        </DialogHeader>

        {/* Desglose */}
        <div className="rounded-xl border border-border bg-background/50 p-4">
          <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
            Detalle de consumo
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto text-sm">
            {items.map((item) => (
              <div key={item.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {item.itemName} <span className="text-muted-foreground">x{item.quantity}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatMoney(Number(item.price) * item.quantity)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-semibold">Total a cobrar</span>
            <span className="text-2xl font-bold text-emerald-400 tabular-nums">
              {formatMoney(total)}
            </span>
          </div>
        </div>

        {/* Form de cobro */}
        <div className="mt-4 space-y-4">
          {/* Método de pago: como botones grandes */}
          <div className="space-y-2">
            <Label>Método de pago</Label>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => setPaymentMethod(opt.value)}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-medium transition-colors',
                    paymentMethod === opt.value
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                      : 'border-border bg-secondary/30 text-muted-foreground hover:border-foreground/30'
                  )}
                >
                  {opt.value === 'CASH' && <Banknote className="h-4 w-4" />}
                  {opt.value === 'CARD' && <CreditCard className="h-4 w-4" />}
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Monto cobrado */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="amount">Monto cobrado</Label>
              {paymentMethod === 'CASH' && change > 0 && (
                <span className="text-xs text-emerald-400">
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
          </div>

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
                className="flex h-24 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/20 text-sm text-muted-foreground hover:border-emerald-500/40 hover:text-foreground transition-colors"
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
            Confirmar cobro {PAYMENT_LABEL[paymentMethod].toLowerCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
