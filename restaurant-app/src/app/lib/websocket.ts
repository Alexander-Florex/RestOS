// ──────────────────────────────────────────────
// websocket.ts — Hook para conexión WebSocket
// ──────────────────────────────────────────────
import { useEffect, useRef, useCallback } from 'react';

export type WsMessageType =
  | 'connected'
  | 'tables_updated'
  | 'menu_updated'
  | 'order_added'
  | 'sale_registered';

export interface WsMessage<T = unknown> {
  type: WsMessageType;
  data: T;
  ts: number;
}

type Listener<T = unknown> = (msg: WsMessage<T>) => void;

// URL del WS: en dev usa el proxy de Vite; en prod usa la variable de entorno
function getWsUrl(): string {
  const envUrl = import.meta.env.VITE_WS_URL;
  if (envUrl) return envUrl;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function useWebSocket(onMessage: (msg: WsMessage) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    try {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => console.log('📡 WebSocket conectado');

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as WsMessage;
          onMessageRef.current(msg);
        } catch { /* ignorar mensajes mal formados */ }
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket desconectado, reconectando en 3s...');
        if (mountedRef.current) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = (err) => {
        console.warn('WebSocket error:', err);
        ws.close();
      };
    } catch (e) {
      console.warn('No se pudo conectar al WebSocket:', e);
      if (mountedRef.current) {
        reconnectTimer.current = setTimeout(connect, 5000);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
