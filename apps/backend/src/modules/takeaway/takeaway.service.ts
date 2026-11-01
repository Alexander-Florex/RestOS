// ──────────────────────────────────────────────
// takeaway.service.ts — multi-tenant
// ──────────────────────────────────────────────
import { TakeawayStatus, PaymentMethod, SaleChannel, type Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { toCents, fromCents, formatCents } from '../../lib/money.js';
import { optionGroupsInclude, resolveItemOptions } from '../../lib/modifiers.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';

export type TakeawayWithItems = Awaited<ReturnType<typeof findOne>>;

async function findOne(id: number, restaurantId: number) {
  const t = await prisma.takeawayOrder.findFirst({
    where: { id, restaurantId },
    include: { items: { include: { menuItem: true } } },
  });
  if (!t) throw HttpError.notFound('Pedido para llevar no encontrado');
  return t;
}

function emit(restaurantId: number, event: string, payload: unknown) {
  ioRestaurant(restaurantId).emit(event, payload);
}

/** Cambia el estado solo si el pedido está en uno de `from`; si no, 409 sin tocar nada. */
async function transition(
  restaurantId: number,
  id: number,
  from: TakeawayStatus[],
  data: Prisma.TakeawayOrderUpdateManyMutationInput,
  conflictMessage: string,
) {
  await findOne(id, restaurantId);
  const { count } = await prisma.takeawayOrder.updateMany({
    where: { id, restaurantId, status: { in: from } },
    data,
  });
  if (count !== 1) throw HttpError.conflict(conflictMessage);
  const order = await findOne(id, restaurantId);
  emit(restaurantId, SocketEvents.TAKEAWAY_UPDATED, order);
  return order;
}

export interface CreateTakeawayInput {
  customerName: string;
  customerPhone?: string | null;
  notes?: string | null;
  createdById?: number;
  /** optionIds: opciones elegidas (ver lib/modifiers.ts); el precio lo calcula el servidor. */
  items: Array<{ menuItemId: number; quantity: number; notes?: string | null; optionIds?: number[] }>;
}

export const takeawayService = {
  async list(restaurantId: number, status?: TakeawayStatus) {
    return prisma.takeawayOrder.findMany({
      where: { restaurantId, ...(status ? { status } : {}) },
      include: { items: { include: { menuItem: true } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(restaurantId: number, id: number) {
    return findOne(id, restaurantId);
  },

  async create(restaurantId: number, input: CreateTakeawayInput) {
    const menuIds = input.items.map(i => i.menuItemId);
    const menuItems = await prisma.menuItem.findMany({
      where: { id: { in: menuIds }, restaurantId, enabled: true },
      include: optionGroupsInclude,
    });
    const menuMap = new Map(menuItems.map(m => [m.id, m]));

    for (const item of input.items) {
      const mi = menuMap.get(item.menuItemId);
      if (!mi) throw HttpError.badRequest(`Ítem ${item.menuItemId} no disponible`);
      if (mi.stock === 'OUT_OF_STOCK') throw HttpError.badRequest(`"${mi.name}" sin stock`);
      if (item.quantity <= 0) throw HttpError.badRequest(`Cantidad inválida para "${mi.name}"`);
    }

    // Precio de cada línea: plato + recargos de las opciones elegidas
    const resolved = input.items.map(item => resolveItemOptions(menuMap.get(item.menuItemId)!, item.optionIds));
    const totalCents = input.items.reduce((acc, item, i) => acc + resolved[i].unitPriceCents * item.quantity, 0);
    const total = fromCents(totalCents);

    const order = await prisma.takeawayOrder.create({
      data: {
        restaurantId,
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        notes: input.notes ?? null,
        createdById: input.createdById ?? null,
        total,
        items: {
          create: input.items.map((item, i) => {
            const mi = menuMap.get(item.menuItemId)!;
            const { modifiers, unitPriceCents } = resolved[i];
            return {
              menuItemId: item.menuItemId,
              itemName: mi.name,
              quantity: item.quantity,
              price: fromCents(unitPriceCents),
              notes: item.notes ?? null,
              modifiers: modifiers.length ? (modifiers as unknown as Prisma.InputJsonValue) : undefined,
            };
          }),
        },
      },
      include: { items: { include: { menuItem: true } } },
    });

    emit(restaurantId, SocketEvents.TAKEAWAY_CREATED, order);
    return order;
  },

  async markReady(restaurantId: number, id: number) {
    return transition(restaurantId, id, [TakeawayStatus.OPEN], { status: TakeawayStatus.READY },
      'Solo se puede marcar como listo un pedido abierto');
  },

  /**
   * Cobra el pedido y registra la venta (canal TAKEAWAY), todo en una transacción:
   * así entra en caja, reportes, CSV y ranking de platos igual que una mesa.
   *
   * - El cambio de estado es condicional (updateMany por estado): dos cobros
   *   simultáneos no cobran dos veces y no se cobra uno cancelado.
   * - La venta tiene takeawayOrderId único: aunque algo fallara arriba, la base
   *   no acepta una segunda venta del mismo pedido.
   * - Los ítems y el total se leen dentro de la transacción, después del cambio de estado.
   */
  async pay(
    restaurantId: number,
    id: number,
    paymentMethod: PaymentMethod,
    amountPaid: number,
    opts: { notes?: string | null; registeredById?: number } = {},
  ) {
    await findOne(id, restaurantId);
    const paidCents = toCents(amountPaid);
    const notes = opts.notes?.trim() || null;

    const sale = await prisma.$transaction(async (tx) => {
      const { count } = await tx.takeawayOrder.updateMany({
        where: { id, restaurantId, status: { in: [TakeawayStatus.OPEN, TakeawayStatus.READY] } },
        data: { status: TakeawayStatus.PAID, paymentMethod, amountPaid: fromCents(paidCents), paidAt: new Date() },
      });
      if (count !== 1) throw HttpError.conflict('El pedido ya fue cobrado o está cancelado');

      const order = await tx.takeawayOrder.findUniqueOrThrow({
        where: { id },
        include: { items: { include: { menuItem: true } } },
      });
      // total es nullable en pedidos viejos: en ese caso se recalcula desde los ítems
      const totalCents = order.total !== null
        ? toCents(order.total)
        : order.items.reduce((acc, i) => acc + toCents(i.price) * i.quantity, 0);
      if (paidCents < totalCents) {
        throw HttpError.badRequest(
          `El monto cobrado (${formatCents(paidCents)}) no cubre el total (${formatCents(totalCents)})`,
        );
      }

      // Las notas del cobro se suman a las del pedido (no se pisan)
      const saleNotes = [order.notes, notes].filter(Boolean).join(' · ') || null;
      if (notes) {
        await tx.takeawayOrder.update({ where: { id }, data: { notes: saleNotes } });
      }

      return tx.sale.create({
        data: {
          restaurantId,
          channel: SaleChannel.TAKEAWAY,
          takeawayOrderId: order.id,
          tableId: null,
          tableNumber: null,
          paymentMethod,
          amount: fromCents(paidCents),
          total: fromCents(totalCents),
          notes: saleNotes,
          registeredById: opts.registeredById ?? null,
          closedAt: new Date(),
          items: {
            create: order.items.map(i => ({
              menuItemId: i.menuItemId,
              itemName: i.itemName,
              category: i.menuItem?.category ?? 'unknown',
              quantity: i.quantity,
              price: i.price,
              subtotal: fromCents(toCents(i.price) * i.quantity),
              modifiers: i.modifiers ?? undefined,
            })),
          },
        },
      });
    });

    const order = await findOne(id, restaurantId);
    emit(restaurantId, SocketEvents.TAKEAWAY_UPDATED, order);
    ioRestaurant(restaurantId).emit(SocketEvents.SALE_REGISTERED, sale);
    return { order, sale };
  },

  async cancel(restaurantId: number, id: number) {
    return transition(restaurantId, id, [TakeawayStatus.OPEN, TakeawayStatus.READY], { status: TakeawayStatus.CANCELLED },
      'No se puede cancelar un pedido ya cobrado o cancelado');
  },

  /**
   * Borra definitivamente un pedido. Solo si está cancelado: uno abierto se
   * cancela primero y uno cobrado nunca se borra (es una venta).
   */
  async remove(restaurantId: number, id: number) {
    await findOne(id, restaurantId);
    const { count } = await prisma.takeawayOrder.deleteMany({
      where: { id, restaurantId, status: TakeawayStatus.CANCELLED },
    });
    if (count !== 1) {
      throw HttpError.conflict('Solo se puede borrar un pedido cancelado. Los cobrados no se borran.');
    }
    ioRestaurant(restaurantId).emit(SocketEvents.TAKEAWAY_DELETED, { id });
  },
};
