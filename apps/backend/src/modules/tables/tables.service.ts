// ──────────────────────────────────────────────
// tables.service.ts — Lógica de negocio de mesas
// ──────────────────────────────────────────────
import { TableStatus, type Prisma, type Table } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { lockTable, type LockedTable } from '../../lib/table-lock.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';

function emitTableChanged(restaurantId: number, table: Table) { ioRestaurant(restaurantId).emit(SocketEvents.TABLE_CHANGED, table); }
function emitTableCreated(restaurantId: number, table: Table) { ioRestaurant(restaurantId).emit(SocketEvents.TABLE_CREATED, table); }
function emitTableDeleted(restaurantId: number, id: number)   { ioRestaurant(restaurantId).emit(SocketEvents.TABLE_DELETED, { id }); }

/**
 * Cambia el estado de una mesa con la fila bloqueada (igual que pedidos y cobro),
 * así dos acciones simultáneas sobre la misma mesa no se pisan.
 * `decide` valida el estado actual y devuelve los datos a guardar, o lanza.
 * Si se pasa `tx`, no emite el evento: lo hace el llamador después del commit.
 */
export async function changeTableStatus(
  restaurantId: number,
  id: number,
  decide: (locked: LockedTable) => Prisma.TableUpdateInput,
  tx?: Prisma.TransactionClient,
): Promise<Table> {
  const run = async (t: Prisma.TransactionClient) => {
    const locked = await lockTable(t, restaurantId, id);
    if (!locked) throw HttpError.notFound('Mesa no encontrada');
    return t.table.update({ where: { id }, data: decide(locked) });
  };
  // Dentro de una transacción ajena, el aviso por socket lo emite quien hace el commit
  if (tx) return run(tx);
  const table = await prisma.$transaction(run);
  emitTableChanged(restaurantId, table);
  return table;
}

export const tablesService = {
  // ── CRUD ──
  async list(restaurantId: number): Promise<Table[]> {
    return prisma.table.findMany({ where: { restaurantId }, orderBy: [{ sectionId: 'asc' }, { number: 'asc' }] });
  },

  async getById(restaurantId: number, id: number): Promise<Table> {
    const table = await prisma.table.findFirst({ where: { id, restaurantId } });
    if (!table) throw HttpError.notFound('Mesa no encontrada');
    return table;
  },

  async create(restaurantId: number, data: { number: number; capacity?: number; sectionId?: number | null }): Promise<Table> {
    const exists = await prisma.table.findUnique({ where: { restaurantId_number: { restaurantId, number: data.number } } });
    if (exists) throw HttpError.conflict(`Ya existe la mesa N° ${data.number}`);

    if (data.sectionId) {
      const section = await prisma.section.findFirst({ where: { id: data.sectionId, restaurantId } });
      if (!section) throw HttpError.notFound('Sección no encontrada');
    }

    const table = await prisma.table.create({
      data: {
        restaurantId,
        number: data.number,
        capacity: data.capacity ?? 4,
        sectionId: data.sectionId ?? null,
        status: TableStatus.AVAILABLE,
        enabled: true,
      },
    });
    emitTableCreated(restaurantId, table);
    return table;
  },

  async update(restaurantId: number, id: number, data: {
    number?: number;
    capacity?: number;
    sectionId?: number | null;
    enabled?: boolean;
  }): Promise<Table> {
    const current = await tablesService.getById(restaurantId, id);

    if (data.number !== undefined && data.number !== current.number) {
      const dup = await prisma.table.findUnique({ where: { restaurantId_number: { restaurantId, number: data.number } } });
      if (dup) throw HttpError.conflict(`Ya existe la mesa N° ${data.number}`);
    }

    if (data.sectionId !== undefined && data.sectionId !== null) {
      const section = await prisma.section.findFirst({ where: { id: data.sectionId, restaurantId } });
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
    emitTableChanged(restaurantId, table);
    return table;
  },

  async remove(restaurantId: number, id: number): Promise<void> {
    const table = await tablesService.getById(restaurantId, id);
    if (table.status !== TableStatus.AVAILABLE) {
      throw HttpError.badRequest('No se puede eliminar una mesa que no está libre');
    }
    // Borrar la mesa borraría en cascada su historial de pedidos (tarea 1.3)
    const history = await prisma.order.count({ where: { tableId: id, restaurantId } });
    if (history > 0) {
      throw HttpError.conflict('La mesa tiene historial de pedidos: deshabilitala en lugar de borrarla.');
    }
    await prisma.table.delete({ where: { id } });
    emitTableDeleted(restaurantId, id);
  },

  async toggleEnabled(restaurantId: number, id: number): Promise<Table> {
    const current = await tablesService.getById(restaurantId, id);
    if (!current.enabled && current.status !== TableStatus.AVAILABLE) {
      throw HttpError.badRequest('Solo se puede reactivar una mesa que esté libre');
    }
    const table = await prisma.table.update({
      where: { id },
      data: { enabled: !current.enabled },
    });
    emitTableChanged(restaurantId, table);
    return table;
  },

  // ── ACCIONES DE ESTADO ──

  /** Abre la mesa. guestCount: mínimo 1, máximo = capacity (sin límite superior artificial). */
  async open(restaurantId: number, id: number, guestCount: number): Promise<Table> {
    if (guestCount < 1) {
      throw HttpError.badRequest('La cantidad de comensales debe ser al menos 1');
    }
    return changeTableStatus(restaurantId, id, (t) => {
      if (!t.enabled) throw HttpError.badRequest('Esta mesa está deshabilitada');
      if (t.status === TableStatus.OCCUPIED) throw HttpError.badRequest('La mesa ya está ocupada');
      if (t.status === TableStatus.BILL_REQUESTED) throw HttpError.badRequest('La mesa tiene una cuenta pendiente de cobro');
      if (guestCount > t.capacity) {
        throw HttpError.badRequest(
          `La mesa tiene capacidad para ${t.capacity} comensales. Si necesitás más, editá la capacidad de la mesa primero.`
        );
      }
      return { status: TableStatus.OCCUPIED, guestCount, openedAt: new Date() };
    });
  },

  /** Marca la mesa como "cuenta pedida". Solo desde OCCUPIED. */
  async requestBill(restaurantId: number, id: number): Promise<Table> {
    return changeTableStatus(restaurantId, id, (t) => {
      if (t.status !== TableStatus.OCCUPIED) throw HttpError.badRequest('Solo se puede pedir cuenta de una mesa ocupada');
      return { status: TableStatus.BILL_REQUESTED };
    });
  },

  /**
   * Libera la mesa sin venta (vuelve a AVAILABLE). Limpia guestCount y openedAt.
   * Si tiene pedidos se rechaza: hay que cobrarla o anular los pedidos, si no
   * la venta se pierde y los pedidos pasan a la próxima mesa que se siente.
   * Bloquea la mesa igual que el alta de pedidos, para que no entre uno en el medio.
   */
  async close(restaurantId: number, id: number): Promise<Table> {
    const table = await prisma.$transaction(async (tx) => {
      const locked = await lockTable(tx, restaurantId, id);
      if (!locked) throw HttpError.notFound('Mesa no encontrada');
      const pending = await tx.order.count({ where: { tableId: id, restaurantId, status: 'OPEN' } });
      if (pending > 0) {
        throw HttpError.conflict('La mesa tiene pedidos sin cobrar. Cobrala o anulá los pedidos antes de liberarla.');
      }
      return tx.table.update({
        where: { id },
        data: {
          status: TableStatus.AVAILABLE,
          guestCount: null,
          openedAt: null,
        },
      });
    });
    emitTableChanged(restaurantId, table);
    return table;
  },


  /** Marca la mesa como reservada. Solo desde AVAILABLE. */
  async reserve(restaurantId: number, id: number): Promise<Table> {
    return changeTableStatus(restaurantId, id, (t) => {
      if (t.status !== TableStatus.AVAILABLE) throw HttpError.badRequest('Solo se puede reservar una mesa libre');
      return { status: TableStatus.RESERVED };
    });
  },

  /** Cancela una reserva (vuelve a AVAILABLE). */
  async cancelReservation(restaurantId: number, id: number): Promise<Table> {
    return changeTableStatus(restaurantId, id, (t) => {
      if (t.status !== TableStatus.RESERVED) throw HttpError.badRequest('La mesa no está reservada');
      return { status: TableStatus.AVAILABLE };
    });
  },
};
