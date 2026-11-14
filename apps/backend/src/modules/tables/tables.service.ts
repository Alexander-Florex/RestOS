// ──────────────────────────────────────────────
// tables.service.ts — Lógica de negocio de mesas
// ──────────────────────────────────────────────
import { TableStatus, TableLabelMode, Prisma, type Table } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { lockTable, lockTables, groupUpdatesAfterLeaving, type LockedTable } from '../../lib/table-lock.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';
import { normalizeTableName, tableLabel, tablesLabel } from '../../shared/table-label.js';

/**
 * Aplica los cambios de grupo y devuelve las mesas tocadas (para avisar por socket).
 * `alsoIds`: otras mesas que cambiaron en la misma operación (por ejemplo, la cobrada).
 */
export async function applyGroupUpdates(
  tx: Prisma.TransactionClient,
  updates: Array<{ ids: number[]; groupId: number | null }>,
  alsoIds: number[],
): Promise<Table[]> {
  for (const u of updates) {
    await tx.table.updateMany({ where: { id: { in: u.ids } }, data: { groupId: u.groupId } });
  }
  const ids = [...new Set([...alsoIds, ...updates.flatMap(u => u.ids)])];
  return ids.length ? tx.table.findMany({ where: { id: { in: ids } } }) : [];
}

/** Cómo muestra las mesas el restaurante (por nombre o por número). */
export async function getTableLabelMode(restaurantId: number, tx: Prisma.TransactionClient = prisma): Promise<TableLabelMode> {
  const r = await tx.restaurant.findUnique({ where: { id: restaurantId }, select: { tableLabelMode: true } });
  return r?.tableLabelMode ?? TableLabelMode.NAME;
}

/** Nombre libre: no puede repetirse en el restaurante (sin distinguir mayúsculas). */
async function assertNameFree(restaurantId: number, name: string | null, exceptId?: number) {
  if (!name) return;
  const dup = await prisma.table.findFirst({ where: { restaurantId, name, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (dup) throw HttpError.conflict(`Ya hay una mesa llamada "${dup.name}" (N° ${dup.number})`);
}

/** El índice único de la base es la garantía final (dos altas simultáneas con el mismo nombre). */
function duplicateName(err: unknown, name: string | null): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw HttpError.conflict(name ? `Ya hay una mesa llamada "${name}"` : 'Ya existe una mesa con ese número');
  }
  throw err;
}

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

  /** Cambia cómo se muestran las mesas en todas las pantallas del restaurante. */
  async setLabelMode(restaurantId: number, mode: TableLabelMode): Promise<TableLabelMode> {
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { tableLabelMode: mode } });
    ioRestaurant(restaurantId).emit(SocketEvents.TABLES_SETTINGS_CHANGED, { labelMode: mode });
    return mode;
  },

  async create(restaurantId: number, data: { number: number; name?: string | null; capacity?: number; sectionId?: number | null }): Promise<Table> {
    const exists = await prisma.table.findUnique({ where: { restaurantId_number: { restaurantId, number: data.number } } });
    if (exists) throw HttpError.conflict(`Ya existe la mesa N° ${data.number}`);
    const name = normalizeTableName(data.name);
    await assertNameFree(restaurantId, name);

    if (data.sectionId) {
      const section = await prisma.section.findFirst({ where: { id: data.sectionId, restaurantId } });
      if (!section) throw HttpError.notFound('Sección no encontrada');
    }

    const table = await prisma.table.create({
      data: {
        restaurantId,
        number: data.number,
        name,
        capacity: data.capacity ?? 4,
        sectionId: data.sectionId ?? null,
        status: TableStatus.AVAILABLE,
        enabled: true,
      },
    }).catch((err) => duplicateName(err, name));
    emitTableCreated(restaurantId, table);
    return table;
  },

  async update(restaurantId: number, id: number, data: {
    number?: number;
    name?: string | null;
    capacity?: number;
    sectionId?: number | null;
    enabled?: boolean;
  }): Promise<Table> {
    const current = await tablesService.getById(restaurantId, id);
    const name = data.name !== undefined ? normalizeTableName(data.name) : undefined;
    if (name !== undefined) await assertNameFree(restaurantId, name, id);

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
        ...(name !== undefined           ? { name }                      : {}),
        ...(data.capacity !== undefined  ? { capacity: data.capacity }   : {}),
        ...(data.sectionId !== undefined ? { sectionId: data.sectionId } : {}),
        ...(data.enabled !== undefined   ? { enabled: data.enabled }     : {}),
      },
    }).catch((err) => duplicateName(err, name ?? null));
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
    // Si está unida a otras, sale del grupo (las demás siguen unidas si quedan dos o más)
    const pre = await tablesService.getById(restaurantId, id);
    const changed = await prisma.$transaction(async (tx) => {
      const lockedAll = await lockTables(tx, restaurantId, [id], pre.groupId);
      const locked = lockedAll.find(t => t.id === id);
      if (!locked) throw HttpError.notFound('Mesa no encontrada');
      if (locked.groupId !== pre.groupId) throw HttpError.conflict('La mesa cambió mientras la liberabas. Probá de nuevo.');
      const pending = await tx.order.count({ where: { tableId: id, restaurantId, status: 'OPEN' } });
      if (pending > 0) {
        throw HttpError.conflict('La mesa tiene pedidos sin cobrar. Cobrala o anulá los pedidos antes de liberarla.');
      }
      await tx.table.update({
        where: { id },
        data: {
          status: TableStatus.AVAILABLE,
          guestCount: null,
          openedAt: null,
        },
      });
      const group = locked.groupId !== null ? lockedAll.filter(t => t.groupId === locked.groupId) : [];
      return applyGroupUpdates(tx, groupUpdatesAfterLeaving(group, [id]), [id]);
    });
    changed.forEach(t => emitTableChanged(restaurantId, t));
    return changed.find(t => t.id === id)!;
  },

  /**
   * Une mesas (tarea 5.3): una familia grande en Ventana + Patio. Cada mesa conserva sus
   * pedidos; la cuenta se ve junta y se cobra junta o por separado. Las libres se abren.
   * Si la mesa ya está unida, las otras se suman a su grupo.
   */
  async join(restaurantId: number, tableId: number, otherIds: number[]): Promise<Table[]> {
    const others = [...new Set(otherIds)].filter(id => id !== tableId);
    if (others.length === 0) throw HttpError.badRequest('Elegí al menos otra mesa para unir');
    const pre = await tablesService.getById(restaurantId, tableId);

    const changed = await prisma.$transaction(async (tx) => {
      const locked = await lockTables(tx, restaurantId, [tableId, ...others], pre.groupId);
      const byId = new Map(locked.map(t => [t.id, t]));
      const head = byId.get(tableId);
      if (!head) throw HttpError.notFound('Mesa no encontrada');
      if (head.groupId !== pre.groupId) throw HttpError.conflict('La mesa cambió mientras la unías. Probá de nuevo.');
      const key = head.groupId ?? head.id;
      const mode = await getTableLabelMode(restaurantId, tx);

      for (const id of [tableId, ...others]) {
        const t = byId.get(id);
        if (!t) throw HttpError.notFound('Mesa no encontrada');
        const label = tableLabel(t, mode);
        if (!t.enabled) throw HttpError.badRequest(`${label} está deshabilitada`);
        if (t.status === TableStatus.RESERVED) throw HttpError.badRequest(`${label} está reservada: cancelá la reserva o sentá a los comensales primero`);
        if (t.groupId !== null && t.groupId !== key) {
          const partners = await tx.table.findMany({ where: { restaurantId, groupId: t.groupId, id: { not: t.id } }, select: { number: true, name: true } });
          throw HttpError.conflict(`${label} ya está unida con ${tablesLabel(partners, mode)}. Separala primero.`);
        }
      }

      const now = new Date();
      const free = [tableId, ...others].filter(id => byId.get(id)!.status === TableStatus.AVAILABLE);
      if (free.length) {
        await tx.table.updateMany({ where: { id: { in: free }, restaurantId }, data: { status: TableStatus.OCCUPIED, openedAt: now } });
      }
      await tx.table.updateMany({ where: { id: { in: [tableId, ...others] }, restaurantId }, data: { groupId: key } });
      return tx.table.findMany({ where: { restaurantId, groupId: key }, orderBy: { number: 'asc' } });
    });
    changed.forEach(t => emitTableChanged(restaurantId, t));
    return changed;
  },

  /** Separa una mesa de su grupo. Conserva sus pedidos y su estado. */
  async separate(restaurantId: number, tableId: number): Promise<Table[]> {
    const pre = await tablesService.getById(restaurantId, tableId);
    if (pre.groupId === null) throw HttpError.badRequest('La mesa no está unida a otra');
    const changed = await prisma.$transaction(async (tx) => {
      const lockedAll = await lockTables(tx, restaurantId, [tableId], pre.groupId);
      const locked = lockedAll.find(t => t.id === tableId);
      if (!locked) throw HttpError.notFound('Mesa no encontrada');
      if (locked.groupId !== pre.groupId) throw HttpError.conflict('La mesa cambió mientras la separabas. Probá de nuevo.');
      const group = lockedAll.filter(t => t.groupId === pre.groupId);
      return applyGroupUpdates(tx, groupUpdatesAfterLeaving(group, [tableId]), []);
    });
    changed.forEach(t => emitTableChanged(restaurantId, t));
    return changed;
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
