// ──────────────────────────────────────────────
// useReservations.ts — Lista de reservas + sync por socket
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { reservationsApi, type Reservation, type ReservationStatus } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';

interface UseReservationsOpts {
  from?: Date;
  to?: Date;
  status?: ReservationStatus;
}

interface UseReservationsResult {
  reservations: Reservation[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useReservations(opts: UseReservationsOpts = {}): UseReservationsResult {
  const { from, to, status } = opts;
  // Serializar para deps estables
  const fromStr = from?.toISOString();
  const toStr = to?.toISOString();

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const { reservations } = await reservationsApi.list({
        from: fromStr ? new Date(fromStr) : undefined,
        to: toStr ? new Date(toStr) : undefined,
        status,
      });
      setReservations(reservations);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las reservas');
    } finally {
      setLoading(false);
    }
  }, [fromStr, toStr, status]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    const onChanged = (updated: Reservation) => {
      setReservations(prev => prev.map(r => (r.id === updated.id ? updated : r)));
    };
    const onCreated = () => { refresh(); };
    const onDeleted = (payload: { id: number }) => {
      setReservations(prev => prev.filter(r => r.id !== payload.id));
    };

    socket.on(SocketEvents.RESERVATION_CHANGED, onChanged);
    socket.on(SocketEvents.RESERVATION_CREATED, onCreated);
    socket.on(SocketEvents.RESERVATION_DELETED, onDeleted);

    return () => {
      socket.off(SocketEvents.RESERVATION_CHANGED, onChanged);
      socket.off(SocketEvents.RESERVATION_CREATED, onCreated);
      socket.off(SocketEvents.RESERVATION_DELETED, onDeleted);
    };
  }, [refresh]);

  return { reservations, loading, error, refresh };
}
