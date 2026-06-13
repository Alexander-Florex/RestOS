// ──────────────────────────────────────────────
// sections.service.ts
// ──────────────────────────────────────────────
import { type Section } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';

function emit(restaurantId: number, event: string, payload: unknown) { ioRestaurant(restaurantId).emit(event, payload); }

export const sectionsService = {
  async list(restaurantId: number): Promise<Section[]> {
    return prisma.section.findMany({ where: { restaurantId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  },

  async getById(restaurantId: number, id: number): Promise<Section> {
    const s = await prisma.section.findFirst({ where: { id, restaurantId } });
    if (!s) throw HttpError.notFound('Sección no encontrada');
    return s;
  },

  async create(restaurantId: number, data: { name: string; color?: string; order?: number }): Promise<Section> {
    const exists = await prisma.section.findUnique({ where: { restaurantId_name: { restaurantId, name: data.name } } });
    if (exists) throw HttpError.conflict(`Ya existe una sección llamada "${data.name}"`);

    const maxOrder = await prisma.section.aggregate({ where: { restaurantId }, _max: { order: true } });
    const section = await prisma.section.create({
      data: {
        restaurantId,
        name: data.name,
        color: data.color ?? '#64748b',
        order: data.order ?? (maxOrder._max.order ?? 0) + 1,
      },
    });
    emit(restaurantId, SocketEvents.SECTION_CREATED, section);
    return section;
  },

  async update(restaurantId: number, id: number, data: { name?: string; color?: string; order?: number }): Promise<Section> {
    const current = await sectionsService.getById(restaurantId, id);
    if (data.name && data.name !== current.name) {
      const dup = await prisma.section.findUnique({ where: { restaurantId_name: { restaurantId, name: data.name } } });
      if (dup) throw HttpError.conflict(`Ya existe una sección llamada "${data.name}"`);
    }
    const section = await prisma.section.update({ where: { id }, data });
    emit(restaurantId, SocketEvents.SECTION_CHANGED, section);
    return section;
  },

  async remove(restaurantId: number, id: number): Promise<void> {
    await sectionsService.getById(restaurantId, id);
    const tablesCount = await prisma.table.count({ where: { sectionId: id } });
    if (tablesCount > 0) {
      throw HttpError.badRequest(
        `No se puede eliminar: hay ${tablesCount} ${tablesCount === 1 ? 'mesa asignada' : 'mesas asignadas'} a esta sección. Reasignales primero.`
      );
    }
    await prisma.section.delete({ where: { id } });
    emit(restaurantId, SocketEvents.SECTION_DELETED, { id });
  },
};
