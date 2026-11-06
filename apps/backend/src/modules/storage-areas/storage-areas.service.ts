// ──────────────────────────────────────────────
// storage-areas.service.ts — Sectores de guardado (tarea 3.1)
// Carnes, cámara, depósito... Cada insumo puede tener uno; ordenan el conteo.
// ──────────────────────────────────────────────
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';

function emitChanged(restaurantId: number) {
  ioRestaurant(restaurantId).emit(SocketEvents.STORAGE_AREAS_CHANGED, {});
}

function duplicateName(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export const storageAreasService = {
  /** Sectores con la cantidad de insumos de cada uno. */
  async list(restaurantId: number) {
    const areas = await prisma.storageArea.findMany({
      where: { restaurantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { items: true } } },
    });
    return areas.map(({ _count, ...a }) => ({ ...a, itemCount: _count.items }));
  },

  async create(restaurantId: number, data: { name: string; sortOrder?: number }) {
    const last = await prisma.storageArea.aggregate({ where: { restaurantId }, _max: { sortOrder: true } });
    try {
      const area = await prisma.storageArea.create({
        data: { restaurantId, name: data.name, sortOrder: data.sortOrder ?? (last._max.sortOrder ?? 0) + 1 },
      });
      emitChanged(restaurantId);
      return area;
    } catch (err) {
      if (duplicateName(err)) throw HttpError.conflict(`Ya existe un sector "${data.name}"`);
      throw err;
    }
  },

  async update(restaurantId: number, id: number, data: { name?: string; sortOrder?: number }) {
    const { count } = await prisma.storageArea.updateMany({ where: { id, restaurantId }, data }).catch((err) => {
      if (duplicateName(err)) throw HttpError.conflict(`Ya existe un sector "${data.name}"`);
      throw err;
    });
    if (count !== 1) throw HttpError.notFound('Sector no encontrado');
    emitChanged(restaurantId);
    return prisma.storageArea.findUniqueOrThrow({ where: { id } });
  },

  /** Borra el sector: sus insumos quedan "sin sector" (no se borran). */
  async remove(restaurantId: number, id: number) {
    const open = await prisma.stockCount.count({ where: { restaurantId, storageAreaId: id, status: 'OPEN' } });
    if (open > 0) throw HttpError.conflict('Hay un conteo abierto de este sector: cerralo o descartalo primero');
    const { count } = await prisma.storageArea.deleteMany({ where: { id, restaurantId } });
    if (count !== 1) throw HttpError.notFound('Sector no encontrado');
    emitChanged(restaurantId);
  },
};
