import { useCallback, useEffect, useState } from 'react';
import { takeawayApi, type TakeawayOrder, type TakeawayStatus } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';

export function useTakeaway(filters?: { status?: TakeawayStatus }) {
  const [orders, setOrders] = useState<TakeawayOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { orders } = await takeawayApi.list(filters);
      setOrders(orders);
    } finally {
      setLoading(false);
    }
  }, [filters?.status]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    const onCreated = (o: TakeawayOrder) =>
      setOrders(prev => [o, ...prev.filter(x => x.id !== o.id)]);
    const onChanged = (o: TakeawayOrder) =>
      setOrders(prev => prev.map(x => x.id === o.id ? o : x));
    const onDeleted = ({ id }: { id: number }) =>
      setOrders(prev => prev.filter(x => x.id !== id));

    socket.on(SocketEvents.TAKEAWAY_CREATED, onCreated);
    socket.on(SocketEvents.TAKEAWAY_CHANGED, onChanged);
    socket.on(SocketEvents.TAKEAWAY_DELETED, onDeleted);
    return () => {
      socket.off(SocketEvents.TAKEAWAY_CREATED, onCreated);
      socket.off(SocketEvents.TAKEAWAY_CHANGED, onChanged);
      socket.off(SocketEvents.TAKEAWAY_DELETED, onDeleted);
    };
  }, []);

  return { orders, loading, refresh };
}
