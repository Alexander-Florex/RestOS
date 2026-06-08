// ──────────────────────────────────────────────
// sockets/index.ts — Setup de Socket.io
// Maneja autenticación de conexión y exporta el `io`
// para que los services emitan eventos.
// ──────────────────────────────────────────────
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { verifyToken } from '../lib/jwt.js';
import { corsOrigins } from '../config/env.js';

let io: SocketIOServer | null = null;

export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
    path: '/socket.io',
  });

  // ── Middleware: verifica token en el handshake ──
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      // Permitimos conexiones anónimas (read-only) — útil para vistas públicas
      // Si en algún momento querés cerrarlas: return next(new Error('No autorizado'));
      return next();
    }

    try {
      const payload = verifyToken(token);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user;
    console.log(
      `📡 Socket conectado: ${socket.id}${user ? ` (user: ${user.username}, ${user.role})` : ' (anónimo)'}`
    );

    socket.on('disconnect', (reason) => {
      console.log(`📴 Socket desconectado: ${socket.id} (${reason})`);
    });
  });

  return io;
}

/** Devuelve el `io` ya inicializado. Lanza si se llama antes de initSocket. */
export function getIO(): SocketIOServer {
  if (!io) throw new Error('Socket.io no inicializado. Llamar initSocket primero.');
  return io;
}

// ── Eventos emitidos (centralizamos los nombres acá) ──
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
  // Reservas
  RESERVATION_CHANGED:     'reservation:changed',
  RESERVATION_CREATED:     'reservation:created',
  RESERVATION_DELETED:     'reservation:deleted',
} as const;
