// ──────────────────────────────────────────────
// useNotifications.ts — Hook global de notificaciones en vivo
//
// Se monta una sola vez en el shell del Dashboard.
// Escucha eventos de socket y dispara:
//   - Toast persistente (sonner)
//   - Sonido sintético
//   - Browser notification (si hay permiso y la pestaña está oculta)
//
// Eventos cubiertos:
//   - order:created          → "Pedido nuevo en mesa X"
//   - table:changed → BILL_REQUESTED → "Mesa X pidió la cuenta"
//   - reservation:created    → "Nueva reserva: Cliente, partySize personas a las HH:MM"
// ──────────────────────────────────────────────
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { getSocket, SocketEvents } from '../lib/socket';
import type { Order, Reservation, Table } from '../lib/api';
import {
  playOrderSound, playBillSound, playReservationSound, browserNotifications,
} from '../lib/notifications';

export function useNotifications() {
  // Para detectar la transición a BILL_REQUESTED (sin spamear en cada update)
  const tableStatusRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    const socket = getSocket();

    const onOrderCreated = (order: Order) => {
      const itemsCount = order.items.reduce((acc, i) => acc + i.quantity, 0);
      toast.success(`Pedido nuevo en mesa`, {
        description: `${itemsCount} ${itemsCount === 1 ? 'ítem' : 'ítems'} enviados al pase`,
        duration: 5000,
      });
      playOrderSound();
      browserNotifications.show('Pedido nuevo', {
        body: `${itemsCount} ${itemsCount === 1 ? 'ítem' : 'ítems'} en cocina`,
        tag: `order-${order.id}`,
      });
    };

    const onTableChanged = (table: Table) => {
      const prev = tableStatusRef.current.get(table.id);
      tableStatusRef.current.set(table.id, table.status);

      // Solo notificar la TRANSICIÓN a BILL_REQUESTED (no si ya estaba así)
      if (table.status === 'BILL_REQUESTED' && prev !== 'BILL_REQUESTED') {
        toast.warning(`Mesa ${table.number} pide la cuenta`, {
          description: 'Pasá por la mesa para cobrar',
          duration: 8000,
        });
        playBillSound();
        browserNotifications.show(`Mesa ${table.number}`, {
          body: 'Pidió la cuenta',
          tag: `bill-${table.id}`,
          requireInteraction: true,
        });
      }
    };

    const onReservationCreated = (reservation: Reservation) => {
      const time = new Date(reservation.reservedAt).toLocaleTimeString('es-AR', {
        hour: '2-digit', minute: '2-digit',
      });
      toast.info(`Nueva reserva: ${reservation.customerName}`, {
        description: `${reservation.partySize} personas · ${time}`,
        duration: 5000,
      });
      playReservationSound();
    };

    socket.on(SocketEvents.ORDER_CREATED, onOrderCreated);
    socket.on(SocketEvents.TABLE_CHANGED, onTableChanged);
    socket.on(SocketEvents.RESERVATION_CREATED, onReservationCreated);

    return () => {
      socket.off(SocketEvents.ORDER_CREATED, onOrderCreated);
      socket.off(SocketEvents.TABLE_CHANGED, onTableChanged);
      socket.off(SocketEvents.RESERVATION_CREATED, onReservationCreated);
    };
  }, []);
}
