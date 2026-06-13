// ──────────────────────────────────────────────
// inventory.service.ts — Lógica de inventario
// ──────────────────────────────────────────────
import { InventoryCategory, type InventoryItem } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';

function emitChanged(restaurantId: number, item: InventoryItem) { ioRestaurant(restaurantId).emit(SocketEvents.INVENTORY_ITEM_CHANGED, item); }
function emitCreated(restaurantId: number, item: InventoryItem) { ioRestaurant(restaurantId).emit(SocketEvents.INVENTORY_ITEM_CREATED, item); }
function emitDeleted(restaurantId: number, id: number)          { ioRestaurant(restaurantId).emit(SocketEvents.INVENTORY_ITEM_DELETED, { id }); }

export interface CreateInventoryData {
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  minStock?: number;
  supplier?: string;
}

export interface UpdateInventoryData extends Partial<CreateInventoryData> {}

export const inventoryService = {
  async list(restaurantId: number, opts?: { category?: InventoryCategory; search?: string }): Promise<InventoryItem[]> {
    return prisma.inventoryItem.findMany({
      where: {
        restaurantId,
        ...(opts?.category ? { category: opts.category } : {}),
        ...(opts?.search ? { name: { contains: opts.search } } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  },

  async getById(restaurantId: number, id: number): Promise<InventoryItem> {
    const item = await prisma.inventoryItem.findFirst({ where: { id, restaurantId } });
    if (!item) throw HttpError.notFound('Ítem de inventario no encontrado');
    return item;
  },

  async create(restaurantId: number, data: CreateInventoryData): Promise<InventoryItem> {
    if (data.quantity < 0) throw HttpError.badRequest('La cantidad no puede ser negativa');
    if (data.minStock !== undefined && data.minStock < 0) {
      throw HttpError.badRequest('El stock mínimo no puede ser negativo');
    }
    const item = await prisma.inventoryItem.create({
      data: {
        restaurantId,
        name: data.name,
        category: data.category,
        quantity: data.quantity,
        unit: data.unit,
        minStock: data.minStock ?? 0,
        supplier: data.supplier ?? null,
        lastRestocked: data.quantity > 0 ? new Date() : null,
      },
    });
    emitCreated(restaurantId, item);
    return item;
  },

  async update(restaurantId: number, id: number, data: UpdateInventoryData): Promise<InventoryItem> {
    await inventoryService.getById(restaurantId, id);
    if (data.quantity !== undefined && data.quantity < 0) {
      throw HttpError.badRequest('La cantidad no puede ser negativa');
    }
    if (data.minStock !== undefined && data.minStock < 0) {
      throw HttpError.badRequest('El stock mínimo no puede ser negativo');
    }
    const item = await prisma.inventoryItem.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
        ...(data.unit !== undefined ? { unit: data.unit } : {}),
        ...(data.minStock !== undefined ? { minStock: data.minStock } : {}),
        ...(data.supplier !== undefined ? { supplier: data.supplier } : {}),
      },
    });
    emitChanged(restaurantId, item);
    return item;
  },

  async remove(restaurantId: number, id: number): Promise<void> {
    await inventoryService.getById(restaurantId, id);
    await prisma.inventoryItem.delete({ where: { id } });
    emitDeleted(restaurantId, id);
  },

  /** Reabastece: suma `amount` a la cantidad y actualiza lastRestocked. */
  async restock(restaurantId: number, id: number, amount: number): Promise<InventoryItem> {
    const current = await inventoryService.getById(restaurantId, id);
    if (amount <= 0) throw HttpError.badRequest('La cantidad a reabastecer debe ser mayor a 0');
    const item = await prisma.inventoryItem.update({
      where: { id },
      data: {
        quantity: current.quantity + amount,
        lastRestocked: new Date(),
      },
    });
    emitChanged(restaurantId, item);
    return item;
  },

  /** Consume: resta `amount` (sin permitir negativos). Útil para integraciones futuras. */
  async consume(restaurantId: number, id: number, amount: number): Promise<InventoryItem> {
    const current = await inventoryService.getById(restaurantId, id);
    if (amount <= 0) throw HttpError.badRequest('La cantidad a consumir debe ser mayor a 0');
    const newQty = Math.max(0, current.quantity - amount);
    const item = await prisma.inventoryItem.update({
      where: { id },
      data: { quantity: newQty },
    });
    emitChanged(restaurantId, item);
    return item;
  },
};
