// ──────────────────────────────────────────────
// reservations.service.ts — Lógica de reservas
//
// Flujo:
// - Cargar reserva con CONFIRMED por default
// - Cerca de la hora, el staff toca "Marcar mesa como reservada" → mesa pasa a RESERVED
// - Cuando llegan: "Sentar comensales" → reserva pasa a SEATED, mesa a OCCUPIED
// - Si no vienen: "Marcar no-show" → reserva NO_SHOW, mesa vuelve a AVAILABLE
// ──────────────────────────────────────────────
import { ReservationStatus, TableStatus, type Reservation } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { getIO, SocketEvents } from '../../sockets/index.js';

function emitChanged(reservation: Reservation) { getIO().emit(SocketEvents.RESERVATION_CHANGED, reservation); }
function emitCreated(reservation: Reservation) { getIO().emit(SocketEvents.RESERVATION_CREATED, reservation); }
function emitDeleted(id: number)                { getIO().emit(SocketEvents.RESERVATION_DELETED, { id }); }

export interface CreateReservationData {
  customerName: string;
  customerPhone?: string | null;
  partySize: number;
  reservedAt: Date;
  duration?: number;
  tableId?: number | null;
  notes?: string | null;
  status?: ReservationStatus;
}

export interface UpdateReservationData extends Partial<CreateReservationData> {}

export interface ListFilters {
  from?: Date;
  to?: Date;
  status?: ReservationStatus;
  tableId?: number;
}

export const reservationsService = {
  async list(filters: ListFilters = {}): Promise<Reservation[]> {
    return prisma.reservation.findMany({
      where: {
        ...((filters.from || filters.to) ? {
          reservedAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.tableId ? { tableId: filters.tableId } : {}),
      },
      orderBy: { reservedAt: 'asc' },
    });
  },

  /** Próximas N reservas activas (CONFIRMED o PENDING) ordenadas por hora ascendente. */
  async upcoming(limit = 20): Promise<Reservation[]> {
    return prisma.reservation.findMany({
      where: {
        reservedAt: { gte: new Date() },
        status: { in: [ReservationStatus.CONFIRMED, ReservationStatus.PENDING] },
      },
      orderBy: { reservedAt: 'asc' },
      take: limit,
    });
  },

  async getById(id: number): Promise<Reservation> {
    const r = await prisma.reservation.findUnique({ where: { id } });
    if (!r) throw HttpError.notFound('Reserva no encontrada');
    return r;
  },

  async create(data: CreateReservationData): Promise<Reservation> {
    if (data.partySize < 1) throw HttpError.badRequest('La cantidad de comensales debe ser ≥ 1');
    if (data.duration !== undefined && data.duration < 15) {
      throw HttpError.badRequest('La duración debe ser de al menos 15 minutos');
    }

    // Si se asigna mesa, validar que exista y tenga capacidad
    if (data.tableId) {
      const table = await prisma.table.findUnique({ where: { id: data.tableId } });
      if (!table) throw HttpError.notFound('Mesa no encontrada');
      if (data.partySize > table.capacity) {
        throw HttpError.badRequest(`La mesa N° ${table.number} tiene capacidad para ${table.capacity}`);
      }
    }

    const reservation = await prisma.reservation.create({
      data: {
        customerName: data.customerName,
        customerPhone: data.customerPhone ?? null,
        partySize: data.partySize,
        reservedAt: data.reservedAt,
        duration: data.duration ?? 90,
        tableId: data.tableId ?? null,
        notes: data.notes ?? null,
        status: data.status ?? ReservationStatus.CONFIRMED,
      },
    });
    emitCreated(reservation);
    return reservation;
  },

  async update(id: number, data: UpdateReservationData): Promise<Reservation> {
    const current = await reservationsService.getById(id);

    if (data.tableId !== undefined && data.tableId !== null && data.tableId !== current.tableId) {
      const table = await prisma.table.findUnique({ where: { id: data.tableId } });
      if (!table) throw HttpError.notFound('Mesa no encontrada');
      const ps = data.partySize ?? current.partySize;
      if (ps > table.capacity) {
        throw HttpError.badRequest(`La mesa N° ${table.number} tiene capacidad para ${table.capacity}`);
      }
    }

    const reservation = await prisma.reservation.update({
      where: { id },
      data: {
        ...(data.customerName !== undefined ? { customerName: data.customerName } : {}),
        ...(data.customerPhone !== undefined ? { customerPhone: data.customerPhone } : {}),
        ...(data.partySize !== undefined ? { partySize: data.partySize } : {}),
        ...(data.reservedAt !== undefined ? { reservedAt: data.reservedAt } : {}),
        ...(data.duration !== undefined ? { duration: data.duration } : {}),
        ...(data.tableId !== undefined ? { tableId: data.tableId } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
    emitChanged(reservation);
    return reservation;
  },

  async remove(id: number): Promise<void> {
    await reservationsService.getById(id);
    await prisma.reservation.delete({ where: { id } });
    emitDeleted(id);
  },

  /** Marca la reserva como cancelada. La mesa (si estaba RESERVED) vuelve a AVAILABLE. */
  async cancel(id: number): Promise<Reservation> {
    const current = await reservationsService.getById(id);
    if (current.status === ReservationStatus.COMPLETED) {
      throw HttpError.badRequest('No se puede cancelar una reserva ya completada');
    }
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.reservation.update({
        where: { id },
        data: { status: ReservationStatus.CANCELLED },
      });
      // Si la mesa asignada estaba en RESERVED, liberarla
      if (current.tableId) {
        const table = await tx.table.findUnique({ where: { id: current.tableId } });
        if (table?.status === TableStatus.RESERVED) {
          const freed = await tx.table.update({
            where: { id: current.tableId },
            data: { status: TableStatus.AVAILABLE },
          });
          getIO().emit(SocketEvents.TABLE_CHANGED, freed);
        }
      }
      emitChanged(updated);
      return updated;
    });
  },

  /** Marca la reserva como no-show. Libera la mesa si estaba RESERVED. */
  async noShow(id: number): Promise<Reservation> {
    const current = await reservationsService.getById(id);
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.reservation.update({
        where: { id },
        data: { status: ReservationStatus.NO_SHOW },
      });
      if (current.tableId) {
        const table = await tx.table.findUnique({ where: { id: current.tableId } });
        if (table?.status === TableStatus.RESERVED) {
          const freed = await tx.table.update({
            where: { id: current.tableId },
            data: { status: TableStatus.AVAILABLE },
          });
          getIO().emit(SocketEvents.TABLE_CHANGED, freed);
        }
      }
      emitChanged(updated);
      return updated;
    });
  },

  /**
   * Sentar a los comensales: marca la mesa como OCCUPIED con la cantidad de
   * la reserva, y pasa la reserva a SEATED.
   * Requiere que la reserva tenga mesa asignada.
   */
  async seat(id: number): Promise<{ reservation: Reservation; tableId: number }> {
    const current = await reservationsService.getById(id);
    if (!current.tableId) {
      throw HttpError.badRequest('La reserva no tiene mesa asignada');
    }
    if (current.status === ReservationStatus.SEATED) {
      throw HttpError.badRequest('La reserva ya está asentada');
    }
    if (current.status === ReservationStatus.COMPLETED || current.status === ReservationStatus.CANCELLED || current.status === ReservationStatus.NO_SHOW) {
      throw HttpError.badRequest('La reserva ya finalizó');
    }

    const table = await prisma.table.findUnique({ where: { id: current.tableId } });
    if (!table) throw HttpError.notFound('La mesa de la reserva ya no existe');
    if (table.status === TableStatus.OCCUPIED || table.status === TableStatus.BILL_REQUESTED) {
      throw HttpError.badRequest('La mesa está ocupada por otros comensales');
    }

    return await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.update({
        where: { id },
        data: { status: ReservationStatus.SEATED },
      });
      const updatedTable = await tx.table.update({
        where: { id: current.tableId! },
        data: {
          status: TableStatus.OCCUPIED,
          guestCount: current.partySize,
          openedAt: new Date(),
        },
      });
      getIO().emit(SocketEvents.TABLE_CHANGED, updatedTable);
      emitChanged(reservation);
      return { reservation, tableId: updatedTable.id };
    });
  },

  /** Marca la mesa asignada a la reserva como RESERVED (típico cuando faltan minutos para que lleguen). */
  async markTableReserved(id: number): Promise<Reservation> {
    const current = await reservationsService.getById(id);
    if (!current.tableId) {
      throw HttpError.badRequest('La reserva no tiene mesa asignada');
    }
    const table = await prisma.table.findUnique({ where: { id: current.tableId } });
    if (!table) throw HttpError.notFound('La mesa de la reserva ya no existe');
    if (table.status !== TableStatus.AVAILABLE) {
      throw HttpError.badRequest('La mesa no está libre. Solo se pueden reservar mesas libres');
    }

    return await prisma.$transaction(async (tx) => {
      const updatedTable = await tx.table.update({
        where: { id: current.tableId! },
        data: { status: TableStatus.RESERVED },
      });
      getIO().emit(SocketEvents.TABLE_CHANGED, updatedTable);
      // No cambiamos el status de la reserva: sigue CONFIRMED hasta que lleguen
      return current;
    });
  },
};
