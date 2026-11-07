// ──────────────────────────────────────────────
// connection.ts — Estado de la conexión con el servidor (tarea 1.5)
//
// Lo marca el socket (que se reconecta solo) y los eventos online/offline del
// navegador. Al volver la conexión después de un corte se emite RESYNC_EVENT:
// las pantallas recargan sus datos porque mientras tanto se perdieron los
// avisos en vivo (pedidos, mesas, cobros de otros dispositivos).
// ──────────────────────────────────────────────
import type { Socket } from 'socket.io-client';

/** idle: sin sesión (no se muestra nada) */
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

/** Evento de ventana: "volvió la conexión, recargá tus datos". */
export const RESYNC_EVENT = 'restos:resync';

let status: ConnectionStatus = 'idle';
let wasDown = false;
const listeners = new Set<(s: ConnectionStatus) => void>();

function set(next: ConnectionStatus) {
  if (next === status) return;
  const prev = status;
  status = next;
  if (next === 'disconnected') wasDown = true;
  if (next === 'connected' && wasDown && prev !== 'idle') {
    wasDown = false;
    window.dispatchEvent(new Event(RESYNC_EVENT));
  }
  for (const l of listeners) l(status);
}

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

export function onConnectionChange(cb: (s: ConnectionStatus) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Lo llama socket.ts al crear el socket. */
export function trackSocket(socket: Socket) {
  socket.on('connect', () => set('connected'));
  socket.on('disconnect', (reason) => {
    // Cierre pedido por la app (logout): no es un corte
    set(reason === 'io client disconnect' ? 'idle' : 'disconnected');
  });
  socket.on('connect_error', () => { if (status !== 'idle') set('disconnected'); });
  socket.io.on('reconnect_attempt', () => { if (status === 'disconnected') set('disconnected'); });
}

/** Lo llama socket.ts al conectar (inicio de sesión). */
export function markConnecting() {
  if (status === 'idle') set('connecting');
}

// Sin red en el dispositivo: avisar de inmediato, sin esperar al timeout del socket
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => { if (status !== 'idle') set('disconnected'); });
}
