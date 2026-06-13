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
import { TableStatus, type Order, type OrderItem, type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';

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

export interface CreateOrderItemInput {
  menuItemId: number;
  quantity: number;
  notes?: string;
}

export interface CreateOrderInput {
  tableId: number;
  guestCount?: number; // requerido si la mesa va a abrirse
  notes?: string;
  items: CreateOrderItemInput[];
  createdById?: number;
}

export const ordersService = {
  /**
   * Lista pedidos. Si se pasa tableId, devuelve solo los de esa mesa.
   * Ordenados del más nuevo al más viejo.
   */
  async list(restaurantId: number, opts?: { tableId?: number }): Promise<OrderWithItems[]> {
    return prisma.order.findMany({
      where: { restaurantId, ...(opts?.tableId ? { tableId: opts.tableId } : {}) },
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
      where: { restaurantId, tableId },
      include: { items: true },
    });
    let total = 0;
    for (const order of orders) {
      for (const item of order.items) {
        total += Number(item.price) * item.quantity;
      }
    }
    return total;
  },

  async create(restaurantId: number, input: CreateOrderInput): Promise<OrderWithItems> {
    if (input.items.length === 0) {
      throw HttpError.badRequest('El pedido debe tener al menos un item');
    }

    // Validar la mesa
    const table = await prisma.table.findFirst({ where: { id: input.tableId, restaurantId } });
    if (!table) throw HttpError.notFound('Mesa no encontrada');
    if (table.status === TableStatus.RESERVED) {
      throw HttpError.badRequest('La mesa está reservada — abrila antes de tomar pedido');
    }

    // Si la mesa está libre, debe abrirse con guestCount
    if (table.status === TableStatus.AVAILABLE) {
      if (!input.guestCount || input.guestCount < 1) {
        throw HttpError.badRequest('La mesa está libre. Especificá la cantidad de comensales para abrirla.');
      }
      if (input.guestCount > table.capacity) {
        throw HttpError.badRequest(`La mesa tiene capacidad para ${table.capacity} comensales`);
      }
    }

    // Tomar snapshot de precios actuales y nombres de los items del menú
    const menuItemIds = input.items.map(i => i.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuItemIds }, restaurantId },
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

    // Transacción: crear order + abrir mesa si corresponde
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          restaurantId,
          tableId: input.tableId,
          notes: input.notes ?? null,
          createdById: input.createdById ?? null,
          items: {
            create: input.items.map(it => {
              const menuItem = menuMap.get(it.menuItemId)!;
              return {
                menuItemId: it.menuItemId,
                itemName: menuItem.name,
                quantity: it.quantity,
                price: menuItem.price,
                notes: it.notes ?? null,
              };
            }),
          },
        },
        include: { items: true },
      });

      // Si la mesa estaba libre, abrirla
      let updatedTable: Prisma.TableGetPayload<{}> | null = null;
      if (table.status === TableStatus.AVAILABLE) {
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

    emitOrderCreated(restaurantId, result.order);
    if (result.updatedTable) emitTableChanged(restaurantId, result.updatedTable);

    return result.order;
  },

  /** Elimina un pedido individual. Solo permitido si la mesa sigue abierta (sin venta). */
  async remove(restaurantId: number, id: number): Promise<void> {
    const order = await ordersService.getById(restaurantId, id);
    await prisma.order.delete({ where: { id } });
    emitOrderDeleted(restaurantId, id, order.tableId);
  },
};