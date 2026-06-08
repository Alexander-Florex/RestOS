// ──────────────────────────────────────────────
// sections.service.ts
// ──────────────────────────────────────────────
import { type Section } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { getIO, SocketEvents } from '../../sockets/index.js';

function emit(event: string, payload: unknown) { getIO().emit(event, payload); }

export const sectionsService = {
  async list(): Promise<Section[]> {
    return prisma.section.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  },

  async getById(id: number): Promise<Section> {
    const s = await prisma.section.findUnique({ where: { id } });
    if (!s) throw HttpError.notFound('Sección no encontrada');
    return s;
  },

  async create(data: { name: string; color?: string; order?: number }): Promise<Section> {
    const exists = await prisma.section.findUnique({ where: { name: data.name } });
    if (exists) throw HttpError.conflict(`Ya existe una sección llamada "${data.name}"`);

    const maxOrder = await prisma.section.aggregate({ _max: { order: true } });
    const section = await prisma.section.create({
      data: {
        name: data.name,
        color: data.color ?? '#64748b',
        order: data.order ?? (maxOrder._max.order ?? 0) + 1,
      },
    });
    emit(SocketEvents.SECTION_CREATED, section);
    return section;
  },

  async update(id: number, data: { name?: string; color?: string; order?: number }): Promise<Section> {
    const current = await sectionsService.getById(id);
    if (data.name && data.name !== current.name) {
      const dup = await prisma.section.findUnique({ where: { name: data.name } });
      if (dup) throw HttpError.conflict(`Ya existe una sección llamada "${data.name}"`);
    }
    const section = await prisma.section.update({ where: { id }, data });
    emit(SocketEvents.SECTION_CHANGED, section);
    return section;
  },

  async remove(id: number): Promise<void> {
    await sectionsService.getById(id);
    const tablesCount = await prisma.table.count({ where: { sectionId: id } });
    if (tablesCount > 0) {
      throw HttpError.badRequest(
        `No se puede eliminar: hay ${tablesCount} ${tablesCount === 1 ? 'mesa asignada' : 'mesas asignadas'} a esta sección. Reasignales primero.`
      );
    }
    await prisma.section.delete({ where: { id } });
    emit(SocketEvents.SECTION_DELETED, { id });
  },
};
