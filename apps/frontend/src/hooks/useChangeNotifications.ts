// ──────────────────────────────────────────────
// useChangeNotifications.ts — Avisos de cambios de platos (tarea 5.8)
// - Al mozo: cuando caja aprueba o rechaza el cambio que pidió.
// - A quien puede autorizar: cuando un mozo pide un cambio (con acción "Ver").
// ──────────────────────────────────────────────
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { ItemChange } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useAuth } from '../context/AuthContext';

export function useChangeNotifications(onOpenRequests?: () => void) {
  const { user, can } = useAuth();
  const canApprove = can('orders.change.approve');
  const openRef = useRef(onOpenRequests);
  openRef.current = onOpenRequests;

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();

    const onResolved = (c: ItemChange) => {
      // Solo el que lo pidió, y solo si lo resolvió otra persona
      if (c.type !== 'REPLACE' || c.requestedBy?.id !== user.id || c.resolvedBy?.id === user.id) return;
      const what = `Mesa ${c.order.table.number}: ${c.quantity}x ${c.itemSnapshot.itemName} → ${c.replacementName ?? 'otro plato'}`;
      if (c.status === 'APPLIED') toast.success('Caja aprobó el cambio', { description: `${what}. Salió el ticket a cocina.`, duration: 8000 });
      if (c.status === 'REJECTED') toast.error('Caja rechazó el cambio', { description: `${what}${c.rejectReason ? ` · ${c.rejectReason}` : ''}`, duration: 10000 });
    };

    const onRequested = (c: ItemChange) => {
      if (!canApprove || c.requestedBy?.id === user.id) return;
      toast.warning(`Mesa ${c.order.table.number} pide cambiar un plato`, {
        description: `${c.quantity}x ${c.itemSnapshot.itemName} → ${c.replacementName ?? 'otro plato'} · ${c.reason}`,
        duration: 15000,
        action: openRef.current ? { label: 'Ver', onClick: () => openRef.current?.() } : undefined,
      });
    };

    socket.on(SocketEvents.ORDER_CHANGE_RESOLVED, onResolved);
    socket.on(SocketEvents.ORDER_CHANGE_REQUESTED, onRequested);
    return () => {
      socket.off(SocketEvents.ORDER_CHANGE_RESOLVED, onResolved);
      socket.off(SocketEvents.ORDER_CHANGE_REQUESTED, onRequested);
    };
  }, [user, canApprove]);
}
