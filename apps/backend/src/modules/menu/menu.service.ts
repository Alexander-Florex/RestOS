// ──────────────────────────────────────────────
// menu.service.ts — Lógica de items del menú
// ──────────────────────────────────────────────
import { StockStatus, type MenuItem } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { getIO, SocketEvents } from '../../sockets/index.js';

function emitChanged(item: MenuItem) {
  getIO().emit(SocketEvents.MENU_ITEM_CHANGED, item);
}
function emitCreated(item: MenuItem) {
  getIO().emit(SocketEvents.MENU_ITEM_CREATED, item);
}
function emitDeleted(id: number) {
  getIO().emit(SocketEvents.MENU_ITEM_DELETED, { id });
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
  async list(opts?: { category?: string; onlyEnabled?: boolean }): Promise<MenuItem[]> {
    return prisma.menuItem.findMany({
      where: {
        ...(opts?.category ? { category: opts.category } : {}),
        ...(opts?.onlyEnabled ? { enabled: true } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  },

  async getById(id: number): Promise<MenuItem> {
    const item = await prisma.menuItem.findUnique({ where: { id } });
    if (!item) throw HttpError.notFound('Item de menú no encontrado');
    return item;
  },

  async create(data: CreateMenuItemData): Promise<MenuItem> {
    const item = await prisma.menuItem.create({
      data: {
        name: data.name,
        category: data.category,
        price: data.price,
        description: data.description ?? null,
        stock: data.stock ?? StockStatus.IN_STOCK,
        enabled: data.enabled ?? true,
        imageUrl: data.imageUrl ?? null,
      },
    });
    emitCreated(item);
    return item;
  },

  async update(id: number, data: UpdateMenuItemData): Promise<MenuItem> {
    await menuService.getById(id);
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
    emitChanged(item);
    return item;
  },

  async remove(id: number): Promise<void> {
    await menuService.getById(id);
    // Verificar si hay pedidos abiertos con este item
    const openOrders = await prisma.orderItem.count({ where: { menuItemId: id } });
    if (openOrders > 0) {
      // Borrar el item: por la FK con SetNull, los OrderItems mantendrán itemName denormalizado
      // Esto está OK porque queremos preservar el histórico
    }
    await prisma.menuItem.delete({ where: { id } });
    emitDeleted(id);
  },

  async toggleEnabled(id: number): Promise<MenuItem> {
    const current = await menuService.getById(id);
    const item = await prisma.menuItem.update({
      where: { id },
      data: { enabled: !current.enabled },
    });
    emitChanged(item);
    return item;
  },

  async setStock(id: number, stock: StockStatus): Promise<MenuItem> {
    await menuService.getById(id);
    const item = await prisma.menuItem.update({
      where: { id },
      data: { stock },
    });
    emitChanged(item);
    return item;
  },
};
