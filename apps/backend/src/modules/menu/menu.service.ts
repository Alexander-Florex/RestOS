// ──────────────────────────────────────────────
// menu.service.ts — Lógica de items del menú
// ──────────────────────────────────────────────
import { StockStatus, type MenuItem } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';

function emitChanged(restaurantId: number, item: MenuItem) {
  ioRestaurant(restaurantId).emit(SocketEvents.MENU_ITEM_CHANGED, item);
}
function emitCreated(restaurantId: number, item: MenuItem) {
  ioRestaurant(restaurantId).emit(SocketEvents.MENU_ITEM_CREATED, item);
}
function emitDeleted(restaurantId: number, id: number) {
  ioRestaurant(restaurantId).emit(SocketEvents.MENU_ITEM_DELETED, { id });
}

export interface CreateMenuItemData {
  name: string;
  category: string;
  price: number;
  description?: string;
  stock?: StockStatus;
  enabled?: boolean;
  imageUrl?: string;
}

export interface UpdateMenuItemData extends Partial<CreateMenuItemData> {}

export const menuService = {
  async list(restaurantId: number, opts?: { category?: string; onlyEnabled?: boolean }): Promise<MenuItem[]> {
    return prisma.menuItem.findMany({
      where: {
        restaurantId,
        ...(opts?.category ? { category: opts.category } : {}),
        ...(opts?.onlyEnabled ? { enabled: true } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  },

  async getById(restaurantId: number, id: number): Promise<MenuItem> {
    const item = await prisma.menuItem.findFirst({ where: { id, restaurantId } });
    if (!item) throw HttpError.notFound('Item de menú no encontrado');
    return item;
  },

  async create(restaurantId: number, data: CreateMenuItemData): Promise<MenuItem> {
    const item = await prisma.menuItem.create({
      data: {
        restaurantId,
        name: data.name,
        category: data.category,
        price: data.price,
        description: data.description ?? null,
        stock: data.stock ?? StockStatus.IN_STOCK,
        enabled: data.enabled ?? true,
        imageUrl: data.imageUrl ?? null,
      },
    });
    emitCreated(restaurantId, item);
    return item;
  },

  async update(restaurantId: number, id: number, data: UpdateMenuItemData): Promise<MenuItem> {
    await menuService.getById(restaurantId, id);
    const item = await prisma.menuItem.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.stock !== undefined ? { stock: data.stock } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.imageUrl !== undefined ? { imageUrl: data.imageUrl } : {}),
      },
    });
    emitChanged(restaurantId, item);
    return item;
  },

  async remove(restaurantId: number, id: number): Promise<void> {
    await menuService.getById(restaurantId, id);
    // Verificar si hay pedidos abiertos con este item
    const openOrders = await prisma.orderItem.count({ where: { menuItemId: id } });
    if (openOrders > 0) {
      // Borrar el item: por la FK con SetNull, los OrderItems mantendrán itemName denormalizado
      // Esto está OK porque queremos preservar el histórico
    }
    await prisma.menuItem.delete({ where: { id } });
    emitDeleted(restaurantId, id);
  },

  async toggleEnabled(restaurantId: number, id: number): Promise<MenuItem> {
    const current = await menuService.getById(restaurantId, id);
    const item = await prisma.menuItem.update({
      where: { id },
      data: { enabled: !current.enabled },
    });
    emitChanged(restaurantId, item);
    return item;
  },

  async setStock(restaurantId: number, id: number, stock: StockStatus): Promise<MenuItem> {
    await menuService.getById(restaurantId, id);
    const item = await prisma.menuItem.update({
      where: { id },
      data: { stock },
    });
    emitChanged(restaurantId, item);
    return item;
  },
};
