// ──────────────────────────────────────────────
// useTableOrders.ts — Pedidos abiertos de una mesa + total
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { ordersApi, type Order } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';

interface UseTableOrdersResult {
  orders: Order[];
  total: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTableOrders(tableId: number | null): UseTableOrdersResult {
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (tableId === null) {
      setOrders([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { orders, total } = await ordersApi.listByTable(tableId);
      setOrders(orders);
      setTotal(total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los pedidos');
    } finally {
      setLoading(false);
    }
  }, [tableId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (tableId === null) return;
    const socket = getSocket();

    const onCreated = (order: Order) => {
      if (order.tableId !== tableId) return;
      refresh();
    };
    const onDeleted = (payload: { id: number; tableId: number }) => {
      if (payload.tableId !== tableId) return;
      refresh();
    };
    // Al registrar venta, se borran los orders de esa mesa
    const onSale = (sale: { tableId: number | null }) => {
      if (sale.tableId !== tableId) return;
      setOrders([]);
      setTotal(0);
    };

    socket.on(SocketEvents.ORDER_CREATED, onCreated);
    socket.on(SocketEvents.ORDER_DELETED, onDeleted);
    socket.on(SocketEvents.SALE_REGISTERED, onSale);

    return () => {
      socket.off(SocketEvents.ORDER_CREATED, onCreated);
      socket.off(SocketEvents.ORDER_DELETED, onDeleted);
      socket.off(SocketEvents.SALE_REGISTERED, onSale);
    };
  }, [tableId, refresh]);

  return { orders, total, loading, error, refresh };
}
