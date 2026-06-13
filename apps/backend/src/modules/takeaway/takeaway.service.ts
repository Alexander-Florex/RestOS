// ──────────────────────────────────────────────
// takeaway.service.ts — multi-tenant
// ──────────────────────────────────────────────
import { TakeawayStatus, PaymentMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
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

export interface CreateTakeawayInput {
  customerName: string;
  customerPhone?: string | null;
  notes?: string | null;
  createdById?: number;
  items: Array<{ menuItemId: number; quantity: number; notes?: string | null }>;
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
    });
    const menuMap = new Map(menuItems.map(m => [m.id, m]));

    for (const item of input.items) {
      const mi = menuMap.get(item.menuItemId);
      if (!mi) throw HttpError.badRequest(`Ítem ${item.menuItemId} no disponible`);
      if (mi.stock === 'OUT_OF_STOCK') throw HttpError.badRequest(`"${mi.name}" sin stock`);
      if (item.quantity <= 0) throw HttpError.badRequest(`Cantidad inválida para "${mi.name}"`);
    }

    const total = input.items.reduce((acc, item) => {
      const mi = menuMap.get(item.menuItemId)!;
      return acc + Number(mi.price) * item.quantity;
    }, 0);

    const order = await prisma.takeawayOrder.create({
      data: {
        restaurantId,
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        notes: input.notes ?? null,
        createdById: input.createdById ?? null,
        total,
        items: {
          create: input.items.map(item => {
            const mi = menuMap.get(item.menuItemId)!;
            return {
              menuItemId: item.menuItemId,
              itemName: mi.name,
              quantity: item.quantity,
              price: mi.price,
              notes: item.notes ?? null,
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
    await findOne(id, restaurantId);
    const order = await prisma.takeawayOrder.update({
      where: { id },
      data: { status: TakeawayStatus.READY },
      include: { items: { include: { menuItem: true } } },
    });
    emit(restaurantId, SocketEvents.TAKEAWAY_UPDATED, order);
    return order;
  },

  async pay(restaurantId: number, id: number, paymentMethod: PaymentMethod, amountPaid: number) {
    await findOne(id, restaurantId);
    const order = await prisma.takeawayOrder.update({
      where: { id },
      data: { status: TakeawayStatus.PAID, paymentMethod, amountPaid, paidAt: new Date() },
      include: { items: { include: { menuItem: true } } },
    });
    emit(restaurantId, SocketEvents.TAKEAWAY_UPDATED, order);
    return order;
  },

  async cancel(restaurantId: number, id: number) {
    await findOne(id, restaurantId);
    const order = await prisma.takeawayOrder.update({
      where: { id },
      data: { status: TakeawayStatus.CANCELLED },
      include: { items: { include: { menuItem: true } } },
    });
    emit(restaurantId, SocketEvents.TAKEAWAY_UPDATED, order);
    return order;
  },

  async remove(restaurantId: number, id: number) {
    await findOne(id, restaurantId);
    await prisma.takeawayOrder.delete({ where: { id } });
    ioRestaurant(restaurantId).emit(SocketEvents.TAKEAWAY_DELETED, { id });
  },
};
