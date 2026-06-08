// ──────────────────────────────────────────────
// inventory.service.ts — Lógica de inventario
// ──────────────────────────────────────────────
import { InventoryCategory, type InventoryItem } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { getIO, SocketEvents } from '../../sockets/index.js';

function emitChanged(item: InventoryItem) { getIO().emit(SocketEvents.INVENTORY_ITEM_CHANGED, item); }
function emitCreated(item: InventoryItem) { getIO().emit(SocketEvents.INVENTORY_ITEM_CREATED, item); }
function emitDeleted(id: number)          { getIO().emit(SocketEvents.INVENTORY_ITEM_DELETED, { id }); }

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
  async list(opts?: { category?: InventoryCategory; search?: string }): Promise<InventoryItem[]> {
    return prisma.inventoryItem.findMany({
      where: {
        ...(opts?.category ? { category: opts.category } : {}),
        ...(opts?.search ? { name: { contains: opts.search } } : {}),
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
  },

  async getById(id: number): Promise<InventoryItem> {
    const item = await prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) throw HttpError.notFound('Ítem de inventario no encontrado');
    return item;
  },

  async create(data: CreateInventoryData): Promise<InventoryItem> {
    if (data.quantity < 0) throw HttpError.badRequest('La cantidad no puede ser negativa');
    if (data.minStock !== undefined && data.minStock < 0) {
      throw HttpError.badRequest('El stock mínimo no puede ser negativo');
    }
    const item = await prisma.inventoryItem.create({
      data: {
        name: data.name,
        category: data.category,
        quantity: data.quantity,
        unit: data.unit,
        minStock: data.minStock ?? 0,
        supplier: data.supplier ?? null,
        lastRestocked: data.quantity > 0 ? new Date() : null,
      },
    });
    emitCreated(item);
    return item;
  },

  async update(id: number, data: UpdateInventoryData): Promise<InventoryItem> {
    await inventoryService.getById(id);
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
    emitChanged(item);
    return item;
  },

  async remove(id: number): Promise<void> {
    await inventoryService.getById(id);
    await prisma.inventoryItem.delete({ where: { id } });
    emitDeleted(id);
  },

  /** Reabastece: suma `amount` a la cantidad y actualiza lastRestocked. */
  async restock(id: number, amount: number): Promise<InventoryItem> {
    const current = await inventoryService.getById(id);
    if (amount <= 0) throw HttpError.badRequest('La cantidad a reabastecer debe ser mayor a 0');
    const item = await prisma.inventoryItem.update({
      where: { id },
      data: {
        quantity: current.quantity + amount,
        lastRestocked: new Date(),
      },
    });
    emitChanged(item);
    return item;
  },

  /** Consume: resta `amount` (sin permitir negativos). Útil para integraciones futuras. */
  async consume(id: number, amount: number): Promise<InventoryItem> {
    const current = await inventoryService.getById(id);
    if (amount <= 0) throw HttpError.badRequest('La cantidad a consumir debe ser mayor a 0');
    const newQty = Math.max(0, current.quantity - amount);
    const item = await prisma.inventoryItem.update({
      where: { id },
      data: { quantity: newQty },
    });
    emitChanged(item);
    return item;
  },
};
