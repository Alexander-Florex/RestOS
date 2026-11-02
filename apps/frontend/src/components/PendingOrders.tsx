// ──────────────────────────────────────────────
// PendingOrders.tsx — Pedidos guardados sin conexión (tarea 1.5)
// Pastilla visible mientras haya pedidos sin enviar; se reenvían solos.
// Si el servidor rechaza uno (ej. plato sin stock), queda marcado para revisar.
// ──────────────────────────────────────────────
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CloudOff, AlertTriangle, RotateCw, Trash2, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from './ui/dialog';
import { Button } from './ui/button';
import { useConfirm } from './ui/confirm-dialog';
import {
  discardQueued, flushQueue, getQueue, onQueueChange, retryQueued, startQueue, type QueuedOrder,
} from '../lib/order-queue';
import { cn } from '../lib/utils';

export function PendingOrders() {
  const [queue, setQueue] = useState<QueuedOrder[]>(getQueue());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  useEffect(() => onQueueChange(setQueue), []);
  useEffect(() => startQueue((sent) => {
    for (const s of sent) toast.success(`Pedido enviado: ${s.label}`, { description: 'Estaba guardado sin conexión' });
  }), []);

  if (queue.length === 0) return null;
  const rejected = queue.filter(q => q.error).length;

  async function retryAll() {
    setBusy(true);
    const sent = await flushQueue();
    setBusy(false);
    for (const s of sent) toast.success(`Pedido enviado: ${s.label}`);
    if (sent.length === 0 && getQueue().some(q => !q.error)) toast.error('Todavía no hay conexión con el servidor');
  }

  async function discard(q: QueuedOrder) {
    if (!await confirm({
      title: `¿Descartar "${q.label}"?`,
      description: 'El pedido no se va a enviar. Avisale a la mesa o al cliente.',
      variant: 'destructive', confirmLabel: 'Descartar',
    })) return;
    discardQueued(q.id);
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className={cn(
          'fixed bottom-24 left-1/2 z-[55] flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-lg backdrop-blur md:bottom-6',
          rejected ? 'border-rose-400/40 bg-rose-950/90 text-rose-100' : 'border-amber-400/40 bg-amber-950/90 text-amber-100',
        )}>
        {rejected ? <AlertTriangle className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
        {queue.length === 1 ? '1 pedido sin enviar' : `${queue.length} pedidos sin enviar`}
        {rejected > 0 && <span className="text-xs opacity-80">· {rejected} para revisar</span>}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pedidos sin enviar</DialogTitle>
            <DialogDescription>
              Se guardaron en este dispositivo porque no había conexión. Se envían solos cuando vuelve; no se duplican.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {queue.map(q => (
              <li key={q.id} className={cn('rounded-xl border p-3 text-sm', q.error ? 'border-rose-400/30 bg-rose-500/5' : 'border-white/[0.08]')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{q.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(q.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {q.error ? (
                  <>
                    <p className="mt-1 text-xs text-rose-300">El servidor lo rechazó: {q.error}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" className="h-8" onClick={() => retryQueued(q.id)}>
                        <RotateCw className="h-3.5 w-3.5" /> Reintentar
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-rose-300" onClick={() => discard(q)}>
                        <Trash2 className="h-3.5 w-3.5" /> Descartar
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">Esperando conexión · {q.attempts} intento(s)</p>
                )}
              </li>
            ))}
          </ul>
          <Button onClick={retryAll} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            Reintentar ahora
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
