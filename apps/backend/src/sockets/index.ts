// ──────────────────────────────────────────────
// sockets/index.ts — Setup de Socket.io
// Maneja autenticación de conexión y exporta el `io`
// para que los services emitan eventos.
// ──────────────────────────────────────────────
import { Server as SocketIOServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import { rolesService } from '../modules/roles/roles.service.js';
import { corsOrigins } from '../config/env.js';
import { SocketEvents } from '../shared/socket-events.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { tableLabel } from '../shared/table-label.js';

let io: SocketIOServer | null = null;

export function initSocket(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
    path: '/socket.io',
  });

  // ── Middleware: token válido de un usuario activo (igual que la API REST) ──
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) return next(new Error('No autorizado'));

    let payload: JwtPayload;
    try {
      payload = verifyToken(token);
    } catch {
      return next(new Error('Token inválido'));
    }
    rolesService.getAccess(payload.userId, payload.restaurantId)
      .then((access) => {
        if (!access.active) return next(new Error('Sesión inválida'));
        socket.data.user = payload;
        next();
      })
      .catch(() => next(new Error('No se pudo validar la sesión')));
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as JwtPayload;
    logger.debug('socket_connected', { socketId: socket.id, userId: user.userId });

    // Room del restaurante (eventos aislados por tenant) y del usuario
    // (para cortarle la conexión si se lo desactiva o borra).
    socket.join(`restaurant-${user.restaurantId}`);
    socket.join(userRoom(user.userId));

    socket.on('disconnect', (reason) => {
      logger.debug('socket_disconnected', { socketId: socket.id, reason });
    });
  });

  return io;
}

/** Devuelve el `io` ya inicializado. Lanza si se llama antes de initSocket. */
export function getIO(): SocketIOServer {
  if (!io) throw new Error('Socket.io no inicializado. Llamar initSocket primero.');
  return io;
}

function userRoom(userId: number) { return `user-${userId}`; }

/** Corta las conexiones en tiempo real de un usuario (al desactivarlo o borrarlo). */
export function disconnectUser(userId: number): void {
  io?.in(userRoom(userId)).disconnectSockets(true);
}

/** Devuelve el namespace del room de un restaurante para emitir eventos aislados por tenant. */
export function ioRestaurant(restaurantId: number) {
  return getIO().to(`restaurant-${restaurantId}`);
}

// Los nombres de eventos viven en src/shared/socket-events.ts (compartido con el frontend)
export { SocketEvents };

/**
 * Emite un evento de impresión al agente local del restaurante.
 * El agente corre en la PC del local y tiene la impresora física conectada.
 *
 * @param restaurantId  ID del restaurante (para el room correcto)
 * @param payload       Datos del ticket a imprimir
 */
export function emitPrintRequest(restaurantId: number, payload: PrintPayload): void {
  // El agente imprime la mesa como la ve el local: "VENTANA" o "Mesa 5" (tableLabel).
  // Si quien pide la impresión no lo trae, se busca acá. tableNumber sigue yendo igual
  // (lo usa el agente actual).
  if (payload.tableLabel !== undefined || !payload.tableNumber) {
    ioRestaurant(restaurantId).emit(SocketEvents.PRINT_REQUEST, payload);
    return;
  }
  Promise.all([
    prisma.table.findUnique({ where: { restaurantId_number: { restaurantId, number: payload.tableNumber } }, select: { number: true, name: true } }),
    prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { tableLabelMode: true } }),
  ])
    .then(([t, r]) => ({ tableName: t?.name ?? null, tableLabel: tableLabel(t ?? { number: payload.tableNumber! }, r?.tableLabelMode) }))
    .catch(() => ({}))
    .then((extra) => ioRestaurant(restaurantId).emit(SocketEvents.PRINT_REQUEST, { ...payload, ...extra }));
}

type PrintPayload = {
  type:          'kitchen' | 'cash';
  tableNumber?:  number;
  /** Nombre de la mesa ("Ventana"), si tiene */
  tableName?:    string | null;
  /** Cómo imprimir la mesa: "Ventana", "Ventana + Patio" o "Mesa 5" */
  tableLabel?:   string;
  orderNumber?:  number;
  isTakeaway?:   boolean;
  takeawayName?: string | null;
  customerName?: string | null;
  /** notes ya incluye las opciones en texto; modifiers las trae por separado (una por línea). */
  items:         Array<{ name?: string; itemName?: string; quantity: number; price?: number; notes?: string | null; modifiers?: string[] }>;
  total?:        number;
  amountPaid?:   number;
  paymentMethod?: string;
  notes?:        string | null;
};
