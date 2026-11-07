// ──────────────────────────────────────────────
// ChangeRequests.tsx — Pedidos de cambio de plato pendientes (tarea 5.8)
// El mozo pide; Caja o Administrador aprueban o rechazan. Se actualiza en vivo.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, X, Loader2, ArrowRight } from 'lucide-react';
import { ordersApi, ApiError, type ItemChange } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useResync } from '../hooks/useConnection';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../lib/format';
import { Button } from './ui/button';
import { ItemModifiers } from './ItemModifiers';

export const FAULT_LABEL: Record<string, string> = {
  KITCHEN: 'Error de cocina', WAITER: 'Error del mozo', CUSTOMER: 'Cambio del cliente', OTHER: 'Otro',
};

/** Pendientes (de una mesa o de todo el salón), en vivo. */
export function usePendingChanges(tableId?: number | null) {
  const [changes, setChanges] = useState<ItemChange[]>([]);
  const refresh = useCallback(async () => {
    if (tableId === null) { setChanges([]); return; }
    try {
      const { changes } = await ordersApi.listChanges({ status: 'PENDING', tableId: tableId ?? undefined });
      setChanges(changes);
    } catch { /* sin permiso o sin red: no se muestra nada */ }
  }, [tableId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useResync(refresh);
  useEffect(() => {
    const socket = getSocket();
    const on = () => { void refresh(); };
    socket.on(SocketEvents.ORDER_CHANGE_REQUESTED, on);
    socket.on(SocketEvents.ORDER_CHANGE_RESOLVED, on);
    socket.on(SocketEvents.SALE_REGISTERED, on);
    return () => {
      socket.off(SocketEvents.ORDER_CHANGE_REQUESTED, on);
      socket.off(SocketEvents.ORDER_CHANGE_RESOLVED, on);
      socket.off(SocketEvents.SALE_REGISTERED, on);
    };
  }, [refresh]);
  return { changes, refresh };
}

export function ChangeRequestCard({ change, showTable = true }: { change: ItemChange; showTable?: boolean }) {
  const { can } = useAuth();
  const canApprove = can('orders.change.approve');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const snap = change.itemSnapshot;

  async function approve() {
    setBusy('approve');
    try {
      await ordersApi.approveChange(change.id);
      toast.success(`Cambio aprobado · Mesa ${change.order.table.number}`, { description: 'Salió el ticket a cocina' });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo aprobar');
    } finally { setBusy(null); }
  }

  async function reject() {
    setBusy('reject');
    try {
      await ordersApi.rejectChange(change.id, rejectReason.trim() || undefined);
      toast.success('Cambio rechazado');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo rechazar');
    } finally { setBusy(null); }
  }

  return (
    <div className="rounded-xl border border-amber-400/30 bg-amber-500/5 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          {showTable && `Mesa ${change.order.table.number} · `}{change.requestedBy?.name ?? 'Mozo'} pide cambiar
        </span>
        <span className="text-xs text-muted-foreground">
          {new Date(change.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-1.5">
        <span>{change.quantity}x {snap.itemName}</span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{change.replacementName ?? 'otro plato'}</span>
      </p>
      <ItemModifiers className="mt-1" modifiers={snap.modifiers} />
      <p className="mt-1 text-xs text-amber-200">
        {change.fault && `${FAULT_LABEL[change.fault]} · `}{change.wasPrepared ? 'Ya estaba hecho (pérdida) · ' : ''}Motivo: {change.reason}
      </p>
      <p className="text-xs text-muted-foreground">No se cobra: {formatMoney(Number(snap.price) * change.quantity)}</p>

      {canApprove && (
        rejecting ? (
          <div className="mt-2 space-y-2">
            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="¿Por qué? (opcional)" maxLength={500}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setRejecting(false)} disabled={busy !== null}>Volver</Button>
              <Button size="sm" variant="destructive" onClick={reject} disabled={busy !== null}>
                {busy === 'reject' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Rechazar
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={approve} disabled={busy !== null}>
              {busy === 'approve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Aprobar
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRejecting(true)} disabled={busy !== null}>
              <X className="h-3.5 w-3.5" /> Rechazar
            </Button>
          </div>
        )
      )}
    </div>
  );
}
