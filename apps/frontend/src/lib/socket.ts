// ──────────────────────────────────────────────
// socket.ts — Cliente Socket.io
// Singleton que se reconecta con el token actual.
// ──────────────────────────────────────────────
import { io, type Socket } from 'socket.io-client';
import { tokenStorage } from './api';

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
  });

  socket.on('connect', () => console.log('📡 Socket conectado:', socket?.id));
  socket.on('disconnect', (reason) => console.log('🔌 Socket desconectado:', reason));
  socket.on('connect_error', (err) => console.warn('Socket error:', err.message));

  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
}

export function disconnectSocket() {
  socket?.disconnect();
}

// ── Eventos centralizados (espejo del backend) ──
export const SocketEvents = {
  // Mesas
  TABLE_CHANGED:           'table:changed',
  TABLE_CREATED:           'table:created',
  TABLE_DELETED:           'table:deleted',
  // Menú
  MENU_ITEM_CHANGED:       'menu-item:changed',
  MENU_ITEM_CREATED:       'menu-item:created',
  MENU_ITEM_DELETED:       'menu-item:deleted',
  // Pedidos
  ORDER_CREATED:           'order:created',
  ORDER_DELETED:           'order:deleted',
  // Ventas
  SALE_REGISTERED:         'sale:registered',
  // Inventario
  INVENTORY_ITEM_CHANGED:  'inventory-item:changed',
  INVENTORY_ITEM_CREATED:  'inventory-item:created',
  INVENTORY_ITEM_DELETED:  'inventory-item:deleted',
  // Staff
  STAFF_CHANGED:           'staff:changed',
  STAFF_CREATED:           'staff:created',
  STAFF_DELETED:           'staff:deleted',
  // Secciones
  SECTION_CHANGED:         'section:changed',
  SECTION_CREATED:         'section:created',
  SECTION_DELETED:         'section:deleted',
  // Para llevar
  TAKEAWAY_CREATED:        'takeaway:created',
  TAKEAWAY_CHANGED:        'takeaway:changed',
  TAKEAWAY_DELETED:        'takeaway:deleted',
  // Reservas
  RESERVATION_CHANGED:     'reservation:changed',
  RESERVATION_CREATED:     'reservation:created',
  RESERVATION_DELETED:     'reservation:deleted',
} as const;
