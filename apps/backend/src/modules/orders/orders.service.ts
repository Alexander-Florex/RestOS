// ──────────────────────────────────────────────
// orders.service.ts — Lógica de pedidos
//
// Comportamiento:
// - Un "Order" es una toma de pedido (puede tener varios OrderItems).
// - Una mesa puede tener varios Orders mientras está abierta (rounds).
// - Al crear un Order:
//     - Si la mesa está AVAILABLE, se abre automáticamente con el guestCount provisto.
//     - Si la mesa está OCCUPIED o BILL_REQUESTED, simplemente se le suma el pedido.
//     - Si está RESERVED, error: hay que abrirla primero.
// - El precio del MenuItem se snapshotea al momento del pedido.
// - Se denormaliza `itemName` por si el item se borra después.
// ──────────────────────────────────────────────
import { OrderStatus, Prisma, TableStatus, type Order, type OrderItem } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { lockTable } from '../../lib/table-lock.js';
import { toCents, fromCents } from '../../lib/money.js';
import { optionGroupsInclude, resolveItemOptions } from '../../lib/modifiers.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';
import { audit } from '../../lib/audit.js';

// Order con sus items y la mesa, listo para enviar al frontend
export type OrderWithItems = Order & { items: OrderItem[] };

function emitOrderCreated(restaurantId: number, order: OrderWithItems) {
  ioRestaurant(restaurantId).emit(SocketEvents.ORDER_CREATED, order);
}
function emitOrderDeleted(restaurantId: number, id: number, tableId: number) {
  ioRestaurant(restaurantId).emit(SocketEvents.ORDER_DELETED, { id, tableId });
}
function emitTableChanged(restaurantId: number, table: unknown) {
  ioRestaurant(restaurantId).emit(SocketEvents.TABLE_CHANGED, table);
}

function findByClientRequestId(restaurantId: number, clientRequestId?: string) {
  if (!clientRequestId) return Promise.resolve(null);
  return prisma.order.findFirst({ where: { restaurantId, clientRequestId }, include: { items: true } });
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export interface CreateOrderItemInput {
  menuItemId: number;
  quantity: number;
  notes?: string;
  /** Opciones elegidas (ver lib/modifiers.ts). El precio lo calcula el servidor. */
  optionIds?: number[];
}

export interface CreateOrderInput {
  tableId: number;
  guestCount?: number; // requerido si la mesa va a abrirse
  notes?: string;
  items: CreateOrderItemInput[];
  createdById?: number;
  /** Id del dispositivo: reintentar con el mismo id devuelve el pedido ya creado (tarea 1.5). */
  clientRequestId?: string;
}

/** Valida que la mesa pueda recibir un pedido (y abrirse si está libre). */
function assertTableAcceptsOrder(
  table: { status: TableStatus; capacity: number },
  guestCount: number | undefined,
) {
  if (table.status === TableStatus.RESERVED) {
    throw HttpError.badRequest('La mesa está reservada — abrila antes de tomar pedido');
  }

  // Si la mesa está libre, debe abrirse con guestCount
  if (table.status === TableStatus.AVAILABLE) {
    if (!guestCount || guestCount < 1) {
      throw HttpError.badRequest('La mesa está libre. Especificá la cantidad de comensales para abrirla.');
    }
    if (guestCount > table.capacity) {
      throw HttpError.badRequest(`La mesa tiene capacidad para ${table.capacity} comensales`);
    }
  }
}

export const ordersService = {
  /**
   * Lista pedidos, del más nuevo al más viejo. Si se pasa tableId, solo los de esa mesa.
   * Por defecto solo los abiertos (la cuenta actual); `status: 'ALL'` incluye el
   * historial (cobrados y anulados).
   */
  async list(restaurantId: number, opts?: { tableId?: number; status?: OrderStatus | 'ALL' }): Promise<OrderWithItems[]> {
    const status = opts?.status ?? OrderStatus.OPEN;
    return prisma.order.findMany({
      where: {
        restaurantId,
        ...(opts?.tableId ? { tableId: opts.tableId } : {}),
        ...(status === 'ALL' ? {} : { status }),
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(restaurantId: number, id: number): Promise<OrderWithItems> {
    const order = await prisma.order.findFirst({
      where: { id, restaurantId },
      include: { items: true },
    });
    if (!order) throw HttpError.notFound('Pedido no encontrado');
    return order;
  },

  /**
   * Total acumulado de los pedidos abiertos de una mesa.
   * Útil para mostrar "la cuenta" antes de cerrar.
   */
  async getTableTotal(restaurantId: number, tableId: number): Promise<number> {
    const orders = await prisma.order.findMany({
      where: { restaurantId, tableId, status: OrderStatus.OPEN },
      include: { items: true },
    });
    let totalCents = 0;
    for (const order of orders) {
      for (const item of order.items) {
        totalCents += toCents(item.price) * item.quantity;
      }
    }
    return fromCents(totalCents);
  },

  async create(restaurantId: number, input: CreateOrderInput): Promise<OrderWithItems> {
    // Reintento de un pedido que ya llegó (el dispositivo no vio la respuesta): devolverlo tal cual
    const already = await findByClientRequestId(restaurantId, input.clientRequestId);
    if (already) return already;

    if (input.items.length === 0) {
      throw HttpError.badRequest('El pedido debe tener al menos un item');
    }

    // Validación temprana de la mesa (se repite dentro de la transacción con la fila bloqueada)
    const table = await prisma.table.findFirst({ where: { id: input.tableId, restaurantId } });
    if (!table) throw HttpError.notFound('Mesa no encontrada');
    assertTableAcceptsOrder(table, input.guestCount);

    // Tomar snapshot de precios actuales y nombres de los items del menú
    const menuItemIds = input.items.map(i => i.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, restaurantId },
      include: optionGroupsInclude,
    });
    const menuMap = new Map(menuItems.map(m => [m.id, m]));

    // Validar que existan y estén habilitados
    for (const it of input.items) {
      const menuItem = menuMap.get(it.menuItemId);
      if (!menuItem) {
        throw HttpError.badRequest(`Item de menú #${it.menuItemId} no existe`);
      }
      if (!menuItem.enabled) {
        throw HttpError.badRequest(`"${menuItem.name}" no está disponible`);
      }
      if (menuItem.stock === 'OUT_OF_STOCK') {
        throw HttpError.badRequest(`"${menuItem.name}" está sin stock`);
      }
      if (it.quantity < 1) {
        throw HttpError.badRequest(`La cantidad de "${menuItem.name}" debe ser mayor a 0`);
      }
    }

    // Opciones y precio final de cada línea (valida contra la carta del restaurante)
    const resolved = input.items.map(it => resolveItemOptions(menuMap.get(it.menuItemId)!, it.optionIds));

    // Transacción: bloquear mesa + crear order + abrir mesa si corresponde.
    // El lock pone este pedido en fila con un cobro simultáneo de la misma mesa
    // (ver lib/table-lock.ts): si la mesa se cobró mientras tanto, se revalida
    // como mesa libre en vez de dejar un pedido huérfano.
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const locked = await lockTable(tx, restaurantId, input.tableId);
        if (!locked) throw HttpError.notFound('Mesa no encontrada');
        assertTableAcceptsOrder(locked, input.guestCount);

        const order = await tx.order.create({
          data: {
            restaurantId,
            tableId: input.tableId,
            notes: input.notes ?? null,
            createdById: input.createdById ?? null,
            clientRequestId: input.clientRequestId ?? null,
            items: {
              create: input.items.map((it, i) => {
                const menuItem = menuMap.get(it.menuItemId)!;
                const { modifiers, unitPriceCents } = resolved[i];
                return {
                  menuItemId: it.menuItemId,
                  itemName: menuItem.name,
                  quantity: it.quantity,
                  price: fromCents(unitPriceCents),
                  notes: it.notes ?? null,
                  modifiers: modifiers.length ? (modifiers as unknown as Prisma.InputJsonValue) : undefined,
                };
              }),
            },
          },
          include: { items: true },
        });

      // Si la mesa estaba libre, abrirla
      let updatedTable: Prisma.TableGetPayload<{}> | null = null;
      if (locked.status === TableStatus.AVAILABLE) {
        updatedTable = await tx.table.update({
          where: { id: input.tableId },
          data: {
            status: TableStatus.OCCUPIED,
            guestCount: input.guestCount!,
            openedAt: new Date(),
          },
        });
      }

      return { order, updatedTable };
      });
    } catch (err) {
      // Dos envíos simultáneos del mismo pedido: el segundo choca con el índice único
      const dup = isUniqueViolation(err) ? await findByClientRequestId(restaurantId, input.clientRequestId) : null;
      if (dup) return dup;
      throw err;
    }

    emitOrderCreated(restaurantId, result.order);
    if (result.updatedTable) emitTableChanged(restaurantId, result.updatedTable);

    return result.order;
  },

  /**
   * Anula un pedido abierto: queda CANCELLED con motivo, quién y cuándo (no se
   * borra, tarea 1.3). Bloquea la mesa igual que el cobro: si se está cobrando,
   * la anulación espera y, cuando el cobro termina, el pedido ya está cobrado (409).
   */
  async cancel(
    restaurantId: number,
    id: number,
    opts: { reason: string; cancelledById?: number | null },
  ): Promise<OrderWithItems> {
    const reason = opts.reason.trim();
    if (!reason) throw HttpError.badRequest('Indicá el motivo de la anulación');

    const order = await ordersService.getById(restaurantId, id);
    const cancelled = await prisma.$transaction(async (tx) => {
      await lockTable(tx, restaurantId, order.tableId);
      const { count } = await tx.order.updateMany({
        where: { id, restaurantId, status: OrderStatus.OPEN },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason: reason,
          cancelledById: opts.cancelledById ?? null,
          closedAt: new Date(),
        },
      });
      if (count !== 1) throw HttpError.conflict('El pedido ya fue cobrado o anulado');
      await audit(tx, {
        restaurantId, action: 'order.cancel', entity: 'Order', entityId: id,
        userId: opts.cancelledById ?? undefined,
        before: {
          tableId: order.tableId, status: 'OPEN',
          items: order.items.map(i => ({ itemName: i.itemName, quantity: i.quantity, price: i.price })),
          total: fromCents(order.items.reduce((s, i) => s + toCents(i.price) * i.quantity, 0)),
        },
        after: { status: 'CANCELLED' },
        reason,
      });
      return tx.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    });
    // Para las pantallas sale de la cuenta abierta igual que antes
    emitOrderDeleted(restaurantId, id, order.tableId);
    return cancelled;
  },
};
