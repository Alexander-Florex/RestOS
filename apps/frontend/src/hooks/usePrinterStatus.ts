// ──────────────────────────────────────────────
// usePrinterStatus.ts — Estado de la comandera y tickets que no salieron (tarea 1.1)
//
// Se recarga al instante cuando un ticket cambia de estado (socket) y al volver la
// conexión. Lo usan la alerta de arriba (PrintAlerts) y la pantalla Comandera.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { printingApi, ApiError, type PrinterStatus } from '../lib/api';
import { getSocket, SocketEvents } from '../lib/socket';
import { useResync } from './useConnection';

export function usePrinterStatus(enabled = true) {
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setStatus(await printingApi.status());
    } catch {
      /* sin conexión: se reintenta al volver (useResync) */
    }
  }, [enabled]);

  useEffect(() => { refresh(); }, [refresh]);
  useResync(refresh);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    // Varios cambios seguidos (una cola entera que sale) → una sola recarga
    const later = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 400);
    };
    socket.on(SocketEvents.PRINT_JOB_UPDATED, later);
    socket.on(SocketEvents.PRINT_REQUEST, later);
    return () => {
      socket.off(SocketEvents.PRINT_JOB_UPDATED, later);
      socket.off(SocketEvents.PRINT_REQUEST, later);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, refresh]);

  const retry = useCallback(async (jobId: number) => {
    try {
      await printingApi.retry(jobId);
      toast.success('Lo mandé de nuevo a la comandera');
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo reintentar');
    }
  }, [refresh]);

  const discard = useCallback(async (jobId: number) => {
    try {
      await printingApi.discard(jobId);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo marcar');
    }
  }, [refresh]);

  return { status, refresh, retry, discard };
}
