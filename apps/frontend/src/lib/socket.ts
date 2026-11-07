// ──────────────────────────────────────────────
// socket.ts — Cliente Socket.io
// Singleton que se reconecta con el token actual.
// ──────────────────────────────────────────────
import { io, type Socket } from 'socket.io-client';
import { tokenStorage } from './api';
import { markConnecting, trackSocket } from './connection';

const URL = import.meta.env.VITE_API_URL || ''; // vacío = mismo origen (proxy)

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(URL, {
    path: '/socket.io',
    autoConnect: false,
    transports: ['websocket', 'polling'],
    auth: (cb) => cb({ token: tokenStorage.get() ?? undefined }),
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    // Tope entre reintentos: si el servidor vuelve, se reconecta en pocos segundos
    reconnectionDelayMax: 5000,
  });

  // Estado visible de la conexión (ConnectionBanner) y recarga al volver
  trackSocket(socket);

  socket.on('connect', () => console.log('📡 Socket conectado:', socket?.id));
  socket.on('disconnect', (reason) => console.log('🔌 Socket desconectado:', reason));
  socket.on('connect_error', (err) => console.warn('Socket error:', err.message));

  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) {
    markConnecting();
    s.connect();
  }
}

export function disconnectSocket() {
  socket?.disconnect();
}

// Nombres de eventos: los mismos valores que usa el backend (un solo archivo)
export { SocketEvents } from '@shared/socket-events';
