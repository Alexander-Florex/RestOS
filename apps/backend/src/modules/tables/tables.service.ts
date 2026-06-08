// ──────────────────────────────────────────────
// tables.service.ts — Lógica de negocio de mesas
// ──────────────────────────────────────────────
import { TableStatus, type Table } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { getIO, SocketEvents } from '../../sockets/index.js';

function emitTableChanged(table: Table) { getIO().emit(SocketEvents.TABLE_CHANGED, table); }
function emitTableCreated(table: Table) { getIO().emit(SocketEvents.TABLE_CREATED, table); }
function emitTableDeleted(id: number)   { getIO().emit(SocketEvents.TABLE_DELETED, { id }); }

export const tablesService = {
  // ── CRUD ──
  async list(): Promise<Table[]> {
    return prisma.table.findMany({ orderBy: [{ sectionId: 'asc' }, { number: 'asc' }] });
  },

  async getById(id: number): Promise<Table> {
    const table = await prisma.table.findUnique({ where: { id } });
    if (!table) throw HttpError.notFound('Mesa no encontrada');
    return table;
  },

  async create(data: { number: number; capacity?: number; sectionId?: number | null }): Promise<Table> {
    const exists = await prisma.table.findUnique({ where: { number: data.number } });
    if (exists) throw HttpError.conflict(`Ya existe la mesa N° ${data.number}`);

    if (data.sectionId) {
      const section = await prisma.section.findUnique({ where: { id: data.sectionId } });
      if (!section) throw HttpError.notFound('Sección no encontrada');
    }

    const table = await prisma.table.create({
      data: {
        number: data.number,
        capacity: data.capacity ?? 4,
        sectionId: data.sectionId ?? null,
        status: TableStatus.AVAILABLE,
        enabled: true,
      },
    });
    emitTableCreated(table);
    return table;
  },

  async update(id: number, data: {
    number?: number;
    capacity?: number;
    sectionId?: number | null;
    enabled?: boolean;
  }): Promise<Table> {
    const current = await tablesService.getById(id);

    if (data.number !== undefined && data.number !== current.number) {
      const dup = await prisma.table.findUnique({ where: { number: data.number } });
      if (dup) throw HttpError.conflict(`Ya existe la mesa N° ${data.number}`);
    }

    if (data.sectionId !== undefined && data.sectionId !== null) {
      const section = await prisma.section.findUnique({ where: { id: data.sectionId } });
      if (!section) throw HttpError.notFound('Sección no encontrada');
    }

    if (data.capacity !== undefined && data.capacity < 1) {
      throw HttpError.badRequest('La capacidad debe ser al menos 1');
    }

    const table = await prisma.table.update({
      where: { id },
      data: {
        ...(data.number !== undefined    ? { number: data.number }       : {}),
        ...(data.capacity !== undefined  ? { capacity: data.capacity }   : {}),
        ...(data.sectionId !== undefined ? { sectionId: data.sectionId } : {}),
        ...(data.enabled !== undefined   ? { enabled: data.enabled }     : {}),
      },
    });
    emitTableChanged(table);
    return table;
  },

  async remove(id: number): Promise<void> {
    const table = await tablesService.getById(id);
    if (table.status !== TableStatus.AVAILABLE) {
      throw HttpError.badRequest('No se puede eliminar una mesa que no está libre');
    }
    await prisma.table.delete({ where: { id } });
    emitTableDeleted(id);
  },

  async toggleEnabled(id: number): Promise<Table> {
    const current = await tablesService.getById(id);
    if (!current.enabled && current.status !== TableStatus.AVAILABLE) {
      throw HttpError.badRequest('Solo se puede reactivar una mesa que esté libre');
    }
    const table = await prisma.table.update({
      where: { id },
      data: { enabled: !current.enabled },
    });
    emitTableChanged(table);
    return table;
  },

  // ── ACCIONES DE ESTADO ──

  /** Abre la mesa. guestCount: mínimo 1, máximo = capacity (sin límite superior artificial). */
  async open(id: number, guestCount: number): Promise<Table> {
    const current = await tablesService.getById(id);
    if (!current.enabled) throw HttpError.badRequest('Esta mesa está deshabilitada');
    if (current.status === TableStatus.OCCUPIED) {
      throw HttpError.badRequest('La mesa ya está ocupada');
    }
    if (current.status === TableStatus.BILL_REQUESTED) {
      throw HttpError.badRequest('La mesa tiene una cuenta pendiente de cobro');
    }
    if (guestCount < 1) {
      throw HttpError.badRequest('La cantidad de comensales debe ser al menos 1');
    }
    if (guestCount > current.capacity) {
      throw HttpError.badRequest(
        `La mesa tiene capacidad para ${current.capacity} comensales. Si necesitás más, editá la capacidad de la mesa primero.`
      );
    }

    const table = await prisma.table.update({
      where: { id },
      data: {
        status: TableStatus.OCCUPIED,
        guestCount,
        openedAt: new Date(),
      },
    });
    emitTableChanged(table);
    return table;
  },

  /** Marca la mesa como "cuenta pedida". Solo desde OCCUPIED. */
  async requestBill(id: number): Promise<Table> {
    const current = await tablesService.getById(id);
    if (current.status !== TableStatus.OCCUPIED) {
      throw HttpError.badRequest('Solo se puede pedir cuenta de una mesa ocupada');
    }
    const table = await prisma.table.update({
      where: { id },
      data: { status: TableStatus.BILL_REQUESTED },
    });
    emitTableChanged(table);
    return table;
  },

  /** Libera la mesa (vuelve a AVAILABLE). Limpia guestCount y openedAt. */
  async close(id: number): Promise<Table> {
    await tablesService.getById(id);
    const table = await prisma.table.update({
      where: { id },
      data: {
        status: TableStatus.AVAILABLE,
        guestCount: null,
        openedAt: null,
      },
    });
    emitTableChanged(table);
    return table;
  },

  /** Marca la mesa como reservada. Solo desde AVAILABLE. */
  async reserve(id: number): Promise<Table> {
    const current = await tablesService.getById(id);
    if (current.status !== TableStatus.AVAILABLE) {
      throw HttpError.badRequest('Solo se puede reservar una mesa libre');
    }
    const table = await prisma.table.update({
      where: { id },
      data: { status: TableStatus.RESERVED },
    });
    emitTableChanged(table);
    return table;
  },

  /** Cancela una reserva (vuelve a AVAILABLE). */
  async cancelReservation(id: number): Promise<Table> {
    const current = await tablesService.getById(id);
    if (current.status !== TableStatus.RESERVED) {
      throw HttpError.badRequest('La mesa no está reservada');
    }
    const table = await prisma.table.update({
      where: { id },
      data: { status: TableStatus.AVAILABLE },
    });
    emitTableChanged(table);
    return table;
  },
};
