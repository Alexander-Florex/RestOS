// ──────────────────────────────────────────────
// useTableOrders.ts — Pedidos abiertos de una mesa + total
// ──────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { ordersApi, type Order } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useResync } from './useConnection';

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

  // Volvió la conexión después de un corte: recargar (se perdieron avisos en vivo)
  useResync(refresh);

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
    // Un plato cambiado o rehecho (tarea 5.8): recargar la cuenta
    const onUpdated = (order: Order) => {
      if (order.tableId !== tableId) return;
      refresh();
    };
    // Al registrar venta, los pedidos de esa mesa pasan a cobrados. Con mesas unidas
    // cobradas juntas, la venta lleva el id de una sola: las demás recargan.
    const onSale = (sale: { tableId: number | null }) => {
      if (sale.tableId !== tableId) { refresh(); return; }
      setOrders([]);
      setTotal(0);
    };

    socket.on(SocketEvents.ORDER_CREATED, onCreated);
    socket.on(SocketEvents.ORDER_DELETED, onDeleted);
    socket.on(SocketEvents.ORDER_UPDATED, onUpdated);
    socket.on(SocketEvents.SALE_REGISTERED, onSale);

    return () => {
      socket.off(SocketEvents.ORDER_CREATED, onCreated);
      socket.off(SocketEvents.ORDER_DELETED, onDeleted);
      socket.off(SocketEvents.ORDER_UPDATED, onUpdated);
      socket.off(SocketEvents.SALE_REGISTERED, onSale);
    };
  }, [tableId, refresh]);

  return { orders, total, loading, error, refresh };
}

/**
 * Pedidos abiertos de varias mesas (mesas unidas, tarea 5.3): la cuenta del grupo.
 * Cada pedido sigue siendo de su mesa (order.tableId); `byTable` tiene el total de cada una.
 */
export function useGroupOrders(tableIds: number[]) {
  const key = [...tableIds].sort((a, b) => a - b).join(',');
  const [orders, setOrders] = useState<Order[]>([]);
  const [byTable, setByTable] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const ids = key ? key.split(',').map(Number) : [];
    if (ids.length === 0) { setOrders([]); setByTable({}); return; }
    try {
      setLoading(true);
      const results = await Promise.all(ids.map(id => ordersApi.listByTable(id)));
      setOrders(results.flatMap(r => r.orders));
      setByTable(Object.fromEntries(ids.map((id, i) => [id, results[i].total])));
    } catch {
      /* se reintenta con el próximo aviso o al reconectar */
    } finally {
      setLoading(false);
    }
  }, [key]);

  useResync(refresh);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!key) return;
    const ids = new Set(key.split(',').map(Number));
    const socket = getSocket();
    const onOrder = (o: { tableId: number }) => { if (ids.has(o.tableId)) refresh(); };
    const onSale = () => { refresh(); };
    socket.on(SocketEvents.ORDER_CREATED, onOrder);
    socket.on(SocketEvents.ORDER_DELETED, onOrder);
    socket.on(SocketEvents.ORDER_UPDATED, onOrder);
    socket.on(SocketEvents.SALE_REGISTERED, onSale);
    return () => {
      socket.off(SocketEvents.ORDER_CREATED, onOrder);
      socket.off(SocketEvents.ORDER_DELETED, onOrder);
      socket.off(SocketEvents.ORDER_UPDATED, onOrder);
      socket.off(SocketEvents.SALE_REGISTERED, onSale);
    };
  }, [key, refresh]);

  const total = Math.round(Object.values(byTable).reduce((s, n) => s + n, 0) * 100) / 100;
  return { orders, byTable, total, loading, refresh };
}
