// ──────────────────────────────────────────────
// inventory.service.ts — Lógica de inventario
// ──────────────────────────────────────────────
import { InventoryCategory, type InventoryItem } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';
import { audit, changedFields } from '../../lib/audit.js';

function emitChanged(restaurantId: number, item: InventoryItem) { ioRestaurant(restaurantId).emit(SocketEvents.INVENTORY_ITEM_CHANGED, item); }
function emitCreated(restaurantId: number, item: InventoryItem) { ioRestaurant(restaurantId).emit(SocketEvents.INVENTORY_ITEM_CREATED, item); }
function emitDeleted(restaurantId: number, id: number)          { ioRestaurant(restaurantId).emit(SocketEvents.INVENTORY_ITEM_DELETED, { id }); }

export interface CreateInventoryData {
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  minStock?: number;
  costPerUnit?: number;
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
        costPerUnit: data.costPerUnit ?? 0,
        supplier: data.supplier ?? null,
        lastRestocked: data.quantity > 0 ? new Date() : null,
      },
    });
    emitCreated(restaurantId, item);
    return item;
  },

  async update(restaurantId: number, id: number, data: UpdateInventoryData): Promise<InventoryItem> {
    const current = await inventoryService.getById(restaurantId, id);
    if (data.quantity !== undefined && data.quantity < 0) {
      throw HttpError.badRequest('La cantidad no puede ser negativa');
    }
    if (data.minStock !== undefined && data.minStock < 0) {
      throw HttpError.badRequest('El stock mínimo no puede ser negativo');
    }
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryItem.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.category !== undefined ? { category: data.category } : {}),
          ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
          ...(data.unit !== undefined ? { unit: data.unit } : {}),
          ...(data.minStock !== undefined ? { minStock: data.minStock } : {}),
          ...(data.costPerUnit !== undefined ? { costPerUnit: data.costPerUnit } : {}),
          ...(data.supplier !== undefined ? { supplier: data.supplier } : {}),
        },
      });
      // Cantidad o costo cambiados a mano: quedan registrados (el resto de los campos no)
      const diff = changedFields(
        { quantity: current.quantity, costPerUnit: String(current.costPerUnit), minStock: current.minStock },
        { quantity: updated.quantity, costPerUnit: String(updated.costPerUnit), minStock: updated.minStock },
        ['quantity', 'costPerUnit', 'minStock'],
      );
      if (diff) {
        await audit(tx, {
          restaurantId, action: 'inventory.update', entity: 'InventoryItem', entityId: id,
          before: { name: current.name, unit: current.unit, ...diff.before },
          after: { name: updated.name, unit: updated.unit, ...diff.after },
        });
      }
      return updated;
    });
    emitChanged(restaurantId, item);
    return item;
  },

  async remove(restaurantId: number, id: number): Promise<void> {
    const current = await inventoryService.getById(restaurantId, id);
    await prisma.$transaction(async (tx) => {
      await tx.inventoryItem.delete({ where: { id } });
      await audit(tx, {
        restaurantId, action: 'inventory.delete', entity: 'InventoryItem', entityId: id,
        before: { name: current.name, quantity: current.quantity, unit: current.unit, costPerUnit: current.costPerUnit },
      });
    });
    emitDeleted(restaurantId, id);
  },

  /** Reabastece: suma `amount` a la cantidad y actualiza lastRestocked. */
  async restock(restaurantId: number, id: number, amount: number): Promise<InventoryItem> {
    await inventoryService.getById(restaurantId, id);
    if (amount <= 0) throw HttpError.badRequest('La cantidad a reabastecer debe ser mayor a 0');
    // increment atómico: dos reposiciones simultáneas no se pisan
    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryItem.update({
        where: { id },
        data: {
          quantity: { increment: amount },
          lastRestocked: new Date(),
        },
      });
      await audit(tx, {
        restaurantId, action: 'inventory.restock', entity: 'InventoryItem', entityId: id,
        before: { name: updated.name, quantity: updated.quantity - amount, unit: updated.unit },
        after: { quantity: updated.quantity, amount },
      });
      return updated;
    });
    emitChanged(restaurantId, item);
    return item;
  },

  /** Consume: resta `amount`. Rechaza consumir más de lo que hay en vez de dejar el stock en 0 a escondidas. */
  async consume(restaurantId: number, id: number, amount: number): Promise<InventoryItem> {
    const current = await inventoryService.getById(restaurantId, id);
    if (amount <= 0) throw HttpError.badRequest('La cantidad a consumir debe ser mayor a 0');
    const item = await prisma.$transaction(async (tx) => {
      const { count } = await tx.inventoryItem.updateMany({
        where: { id, restaurantId, quantity: { gte: amount } },
        data: { quantity: { decrement: amount } },
      });
      if (count !== 1) {
        throw HttpError.badRequest(`No hay stock suficiente de "${current.name}" (quedan ${current.quantity} ${current.unit})`);
      }
      const updated = await tx.inventoryItem.findUniqueOrThrow({ where: { id } });
      await audit(tx, {
        restaurantId, action: 'inventory.consume', entity: 'InventoryItem', entityId: id,
        before: { name: updated.name, quantity: updated.quantity + amount, unit: updated.unit },
        after: { quantity: updated.quantity, amount },
      });
      return updated;
    });
    emitChanged(restaurantId, item);
    return item;
  },
};
