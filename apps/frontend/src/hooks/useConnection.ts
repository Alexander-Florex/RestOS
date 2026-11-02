// ──────────────────────────────────────────────
// useConnection.ts — Estado de la conexión y recarga al reconectar (tarea 1.5)
// ──────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { getConnectionStatus, onConnectionChange, RESYNC_EVENT, type ConnectionStatus } from '../lib/connection';

export function useConnectionStatus(): ConnectionStatus {
  const [status, setStatus] = useState(getConnectionStatus());
  useEffect(() => onConnectionChange(setStatus), []);
  return status;
}

/**
 * Llama a `refresh` cuando vuelve la conexión después de un corte: mientras
 * estuvo caída se perdieron los avisos en vivo y los datos pueden estar viejos.
 */
export function useResync(refresh: () => unknown) {
  const ref = useRef(refresh);
  ref.current = refresh;
  useEffect(() => {
    const onResync = () => { void ref.current(); };
    window.addEventListener(RESYNC_EVENT, onResync);
    return () => window.removeEventListener(RESYNC_EVENT, onResync);
  }, []);
}
