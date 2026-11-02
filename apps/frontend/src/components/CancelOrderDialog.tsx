// ──────────────────────────────────────────────
// CancelOrderDialog.tsx — Anular un pedido de la mesa, con motivo
// El pedido no se borra: queda en el historial como anulado (tareas 1.2 y 1.3).
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, XCircle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import { ordersApi, ApiError, type Order } from '../lib/api';
import { formatMoney } from '../lib/format';
import { cn } from '../lib/utils';

const QUICK_REASONS = [
  'Se cargó por error',
  'Mesa equivocada',
  'El cliente se arrepintió (no salió de cocina)',
  'Pedido duplicado',
];

export function CancelOrderDialog({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (order) { setReason(''); setSaving(false); } }, [order]);

  const total = order?.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0) ?? 0;
  const valid = reason.trim().length >= 3;

  async function confirm() {
    if (!order || !valid) return;
    setSaving(true);
    try {
      await ordersApi.cancel(order.id, reason.trim());
      toast.success(`Pedido #${order.id} anulado`);
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo anular el pedido');
      setSaving(false);
    }
  }

  return (
    <Dialog open={order !== null} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-rose-400" /> Anular pedido #{order?.id}
          </DialogTitle>
          <DialogDescription>
            Sale de la cuenta ({formatMoney(total)}) y queda registrado como anulado, con el motivo y quién lo anuló.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5 text-sm">
            {order?.items.map(i => (
              <p key={i.id} className="truncate">{i.quantity}x {i.itemName}</p>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map(r => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  reason === r ? 'border-rose-400/50 bg-rose-500/10 text-rose-200' : 'border-border text-muted-foreground hover:text-foreground',
                )}>
                {r}
              </button>
            ))}
          </div>
          <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} autoFocus
            aria-label="Motivo de la anulación" placeholder="Motivo (obligatorio)"
            className="w-full resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Volver</Button>
          <Button variant="destructive" onClick={confirm} disabled={saving || !valid}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Anular pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
