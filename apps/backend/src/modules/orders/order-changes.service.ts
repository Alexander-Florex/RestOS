// ──────────────────────────────────────────────
// order-changes.service.ts — Cambiar o rehacer platos ya pedidos (tarea 5.8)
//
// Reglas del cliente (CLAUDE.md §10):
// - Se cobra solo lo que se consume: un plato cambiado NO se cobra. Si ya
//   estaba hecho, se registra como pérdida (merma).
// - Rehacer (cocina se equivocó / salió mal): se cobra una sola vez; lo que se
//   tiró es pérdida.
// - Siempre con motivo y de quién fue el error.
// - El mozo puede PEDIR un cambio; lo aprueba Caja o Administrador
//   (permiso orders.change.approve), que también pueden hacerlo directo.
// Todo corre con la mesa bloqueada (lib/table-lock.ts), igual que el cobro.
// ──────────────────────────────────────────────
import {
  ItemChangeFault, ItemChangeStatus, ItemChangeType, OrderItemStatus, OrderStatus, Prisma,
  type OrderItem, type OrderItemChange,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { lockTable } from '../../lib/table-lock.js';
import { fromCents, toCents } from '../../lib/money.js';
import { audit } from '../../lib/audit.js';
import { itemNotesForPrint, modifierLines, optionGroupsInclude, resolveItemOptions } from '../../lib/modifiers.js';
import { emitPrintRequest, ioRestaurant, SocketEvents } from '../../sockets/index.js';

type Tx = Prisma.TransactionClient;

export interface ChangeBase {
  quantity: number;
  reason: string;
  fault?: ItemChangeFault | null;
  userId?: number | null;
}

export interface ReplaceInput extends ChangeBase {
  wasPrepared: boolean;
  replacement: { menuItemId: number; optionIds?: number[]; notes?: string | null };
}

const changeInclude = {
  order: { select: { id: true, tableId: true, status: true, table: { select: { number: true, name: true } } } },
  requestedBy: { select: { id: true, name: true } },
  resolvedBy: { select: { id: true, name: true } },
} satisfies Prisma.OrderItemChangeInclude;

type ChangeRow = Prisma.OrderItemChangeGetPayload<{ include: typeof changeInclude }>;
/** Cambio con el nombre del plato de reemplazo (para mostrarlo sin buscar en la carta). */
export type ChangeWithRefs = ChangeRow & { replacementName: string | null };

async function withNames(rows: ChangeRow[]): Promise<ChangeWithRefs[]> {
  const ids = [...new Set(rows.map(r => r.replacementMenuItemId).filter((x): x is number => x !== null))];
  const names = new Map(
    (await prisma.menuItem.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(m => [m.id, m.name]),
  );
  return rows.map(r => ({ ...r, replacementName: r.replacementMenuItemId ? names.get(r.replacementMenuItemId) ?? null : null }));
}

function cleanReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 3) throw HttpError.badRequest('Escribí el motivo del cambio');
  return r;
}

/** Copia del ítem al momento del cambio (para mostrar e informar pérdidas). */
function snapshot(item: OrderItem) {
  return {
    itemName: item.itemName,
    price: item.price.toString(),
    modifiers: item.modifiers ?? null,
    notes: item.notes,
  };
}

/** Ítem de un pedido abierto del restaurante, con la mesa ya bloqueada. */
async function lockItem(tx: Tx, restaurantId: number, orderItemId: number) {
  const item = await tx.orderItem.findFirst({
    where: { id: orderItemId, order: { restaurantId } },
    include: { order: { include: { table: true } } },
  });
  if (!item) throw HttpError.notFound('Plato no encontrado');
  await lockTable(tx, restaurantId, item.order.tableId);
  // Releer después del lock: un cobro o cambio simultáneo pudo modificarlo
  const fresh = await tx.orderItem.findUniqueOrThrow({
    where: { id: orderItemId },
    include: { order: { include: { table: true } } },
  });
  if (fresh.order.status !== OrderStatus.OPEN) throw HttpError.conflict('El pedido ya fue cobrado o anulado');
  if (fresh.status !== OrderItemStatus.ACTIVE) throw HttpError.conflict('Ese plato ya fue cambiado');
  return fresh;
}

function assertQuantity(item: OrderItem, quantity: number) {
  if (quantity < 1 || quantity > item.quantity) {
    throw HttpError.badRequest(`Podés cambiar entre 1 y ${item.quantity} unidad(es) de "${item.itemName}"`);
  }
}

/** Valida el plato de reemplazo y calcula su precio con opciones. */
async function resolveReplacement(db: Tx | typeof prisma, restaurantId: number, r: ReplaceInput['replacement']) {
  const menuItem = await db.menuItem.findFirst({ where: { id: r.menuItemId, restaurantId }, include: optionGroupsInclude });
  if (!menuItem) throw HttpError.badRequest('El plato de reemplazo no existe');
  if (!menuItem.enabled) throw HttpError.badRequest(`"${menuItem.name}" no está disponible`);
  if (menuItem.stock === 'OUT_OF_STOCK') throw HttpError.badRequest(`"${menuItem.name}" está sin stock`);
  return { menuItem, ...resolveItemOptions(menuItem, r.optionIds ?? []) };
}

/** Aplica un cambio de plato (dentro de la transacción, con la mesa bloqueada). */
async function applyReplace(tx: Tx, restaurantId: number, change: OrderItemChange, resolverId: number | null) {
  const item = await lockItem(tx, restaurantId, change.orderItemId);
  assertQuantity(item, change.quantity);
  const replacement = await resolveReplacement(tx, restaurantId, {
    menuItemId: change.replacementMenuItemId!,
    optionIds: (change.replacementOptionIds as number[] | null) ?? [],
    notes: change.replacementNotes,
  });
  const now = new Date();
  const voidReason = change.wasPrepared ? `Cambio (ya estaba hecho): ${change.reason}` : `Cambio: ${change.reason}`;

  // Anular solo las unidades cambiadas: si eran 2 y cambian 1, se separa esa unidad
  let voided: OrderItem;
  if (change.quantity < item.quantity) {
    await tx.orderItem.update({ where: { id: item.id }, data: { quantity: item.quantity - change.quantity } });
    voided = await tx.orderItem.create({
      data: {
        orderId: item.orderId, menuItemId: item.menuItemId, itemName: item.itemName,
        quantity: change.quantity, price: item.price, notes: item.notes,
        modifiers: item.modifiers ?? undefined,
        status: OrderItemStatus.VOIDED, voidedAt: now, voidReason,
      },
    });
  } else {
    voided = await tx.orderItem.update({
      where: { id: item.id },
      data: { status: OrderItemStatus.VOIDED, voidedAt: now, voidReason },
    });
  }

  const created = await tx.orderItem.create({
    data: {
      orderId: item.orderId,
      menuItemId: replacement.menuItem.id,
      itemName: replacement.menuItem.name,
      quantity: change.quantity,
      price: fromCents(replacement.unitPriceCents),
      notes: change.replacementNotes ?? null,
      modifiers: replacement.modifiers.length ? (replacement.modifiers as unknown as Prisma.InputJsonValue) : undefined,
    },
  });

  const { count } = await tx.orderItemChange.updateMany({
    where: { id: change.id, status: ItemChangeStatus.PENDING },
    data: {
      status: ItemChangeStatus.APPLIED, resolvedById: resolverId, resolvedAt: now,
      newOrderItemId: created.id, voidedOrderItemId: voided.id,
    },
  });
  if (count !== 1) throw HttpError.conflict('Ese pedido de cambio ya fue resuelto');

  await audit(tx, {
    restaurantId, action: 'order.item.replace', entity: 'OrderItem', entityId: item.id,
    userId: resolverId ?? undefined,
    before: { tableNumber: item.order.table.number, quantity: change.quantity, ...snapshot(item) },
    after: {
      itemName: created.itemName, price: created.price, quantity: created.quantity, modifiers: created.modifiers ?? null,
      wasPrepared: change.wasPrepared, fault: change.fault, lostValue: fromCents(toCents(item.price) * change.quantity),
    },
    reason: change.reason,
  });

  return { item, voided, created, tableNumber: item.order.table.number };
}

function emitOrder(restaurantId: number, orderId: number) {
  return prisma.order.findUnique({ where: { id: orderId }, include: { items: true } }).then((order) => {
    if (order) ioRestaurant(restaurantId).emit(SocketEvents.ORDER_UPDATED, order);
  });
}

async function loadChange(id: number): Promise<ChangeWithRefs> {
  const [row] = await withNames([await prisma.orderItemChange.findUniqueOrThrow({ where: { id }, include: changeInclude })]);
  return row;
}

export const orderChangesService = {
  /**
   * Rehacer: se cobra una sola vez; lo tirado es pérdida. Sale un ticket
   * "REHACER" a cocina. Lo puede hacer quien toma pedidos.
   */
  async remake(restaurantId: number, orderItemId: number, input: ChangeBase): Promise<ChangeWithRefs> {
    const reason = cleanReason(input.reason);
    const result = await prisma.$transaction(async (tx) => {
      const item = await lockItem(tx, restaurantId, orderItemId);
      assertQuantity(item, input.quantity);
      const change = await tx.orderItemChange.create({
        data: {
          restaurantId, orderId: item.orderId, orderItemId: item.id,
          type: ItemChangeType.REMAKE, status: ItemChangeStatus.APPLIED,
          quantity: input.quantity, reason, fault: input.fault ?? null, wasPrepared: true,
          itemSnapshot: snapshot(item) as Prisma.InputJsonValue,
          requestedById: input.userId ?? null, resolvedById: input.userId ?? null, resolvedAt: new Date(),
        },
      });
      await audit(tx, {
        restaurantId, action: 'order.item.remake', entity: 'OrderItem', entityId: item.id,
        userId: input.userId ?? undefined,
        before: { tableNumber: item.order.table.number, quantity: input.quantity, ...snapshot(item) },
        after: { fault: input.fault ?? null, lostValue: fromCents(toCents(item.price) * input.quantity) },
        reason,
      });
      return { change, item };
    });

    emitPrintRequest(restaurantId, {
      type: 'kitchen',
      tableNumber: result.item.order.table.number,
      orderNumber: result.item.orderId,
      items: [{
        name: `REHACER: ${result.item.itemName}`,
        quantity: input.quantity,
        notes: [itemNotesForPrint(result.item.modifiers, result.item.notes), `Motivo: ${reason}`].filter(Boolean).join(' · '),
        modifiers: modifierLines(result.item.modifiers),
      }],
    });
    const full = await loadChange(result.change.id);
    ioRestaurant(restaurantId).emit(SocketEvents.ORDER_CHANGE_RESOLVED, full);
    return full;
  },

  /**
   * Cambiar por otro plato. Con permiso de aprobar se aplica en el acto; si no
   * (mozo), queda PENDING hasta que Caja o el Administrador lo aprueben.
   */
  async replace(restaurantId: number, orderItemId: number, input: ReplaceInput, canApprove: boolean): Promise<ChangeWithRefs> {
    const reason = cleanReason(input.reason);
    // Validar el reemplazo antes (mensaje claro si no está disponible)
    await resolveReplacement(prisma, restaurantId, input.replacement);

    const result = await prisma.$transaction(async (tx) => {
      const item = await lockItem(tx, restaurantId, orderItemId);
      assertQuantity(item, input.quantity);
      const change = await tx.orderItemChange.create({
        data: {
          restaurantId, orderId: item.orderId, orderItemId: item.id,
          type: ItemChangeType.REPLACE, status: ItemChangeStatus.PENDING,
          quantity: input.quantity, reason, fault: input.fault ?? null, wasPrepared: input.wasPrepared,
          itemSnapshot: snapshot(item) as Prisma.InputJsonValue,
          replacementMenuItemId: input.replacement.menuItemId,
          replacementOptionIds: (input.replacement.optionIds ?? []) as Prisma.InputJsonValue,
          replacementNotes: input.replacement.notes?.trim() || null,
          requestedById: input.userId ?? null,
        },
      });
      const applied = canApprove ? await applyReplace(tx, restaurantId, change, input.userId ?? null) : null;
      return { change, applied };
    });

    const full = await loadChange(result.change.id);
    if (result.applied) {
      printChange(restaurantId, result.applied, input.quantity, reason);
      await emitOrder(restaurantId, result.applied.item.orderId);
      ioRestaurant(restaurantId).emit(SocketEvents.ORDER_CHANGE_RESOLVED, full);
    } else {
      ioRestaurant(restaurantId).emit(SocketEvents.ORDER_CHANGE_REQUESTED, full);
    }
    return full;
  },

  /** Caja / Administrador aprueba un cambio pedido por el mozo. */
  async approve(restaurantId: number, changeId: number, approverId: number | null): Promise<ChangeWithRefs> {
    const applied = await prisma.$transaction(async (tx) => {
      const change = await tx.orderItemChange.findFirst({ where: { id: changeId, restaurantId } });
      if (!change) throw HttpError.notFound('Pedido de cambio no encontrado');
      if (change.status !== ItemChangeStatus.PENDING) throw HttpError.conflict('Ese pedido de cambio ya fue resuelto');
      return { change, result: await applyReplace(tx, restaurantId, change, approverId) };
    });
    printChange(restaurantId, applied.result, applied.change.quantity, applied.change.reason);
    await emitOrder(restaurantId, applied.change.orderId);
    const full = await loadChange(changeId);
    ioRestaurant(restaurantId).emit(SocketEvents.ORDER_CHANGE_RESOLVED, full);
    return full;
  },

  /** Caja / Administrador rechaza un cambio pedido por el mozo (el plato sigue igual). */
  async reject(restaurantId: number, changeId: number, approverId: number | null, rejectReason?: string | null): Promise<ChangeWithRefs> {
    await prisma.$transaction(async (tx) => {
      const change = await tx.orderItemChange.findFirst({ where: { id: changeId, restaurantId } });
      if (!change) throw HttpError.notFound('Pedido de cambio no encontrado');
      const { count } = await tx.orderItemChange.updateMany({
        where: { id: changeId, status: ItemChangeStatus.PENDING },
        data: { status: ItemChangeStatus.REJECTED, resolvedById: approverId, resolvedAt: new Date(), rejectReason: rejectReason?.trim() || null },
      });
      if (count !== 1) throw HttpError.conflict('Ese pedido de cambio ya fue resuelto');
      await audit(tx, {
        restaurantId, action: 'order.item.reject', entity: 'OrderItemChange', entityId: changeId,
        userId: approverId ?? undefined,
        before: { ...(change.itemSnapshot as object), quantity: change.quantity, reason: change.reason },
        reason: rejectReason?.trim() || null,
      });
    });
    const full = await loadChange(changeId);
    ioRestaurant(restaurantId).emit(SocketEvents.ORDER_CHANGE_RESOLVED, full);
    return full;
  },

  /** Cambios del restaurante: pendientes (para caja) o historial de un rango. */
  async list(restaurantId: number, q: { status?: ItemChangeStatus; from?: Date; to?: Date; tableId?: number }) {
    const rows = await prisma.orderItemChange.findMany({
      where: {
        restaurantId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
        ...(q.tableId ? { order: { tableId: q.tableId } } : {}),
        // Los pendientes de pedidos ya cerrados no se pueden aprobar: no se listan
        ...(q.status === ItemChangeStatus.PENDING ? { order: { status: OrderStatus.OPEN, ...(q.tableId ? { tableId: q.tableId } : {}) } } : {}),
      },
      include: changeInclude,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return withNames(rows);
  },
};

/** Ticket a cocina: qué anular y qué hacer. */
function printChange(
  restaurantId: number,
  applied: Awaited<ReturnType<typeof applyReplace>>,
  quantity: number,
  reason: string,
) {
  emitPrintRequest(restaurantId, {
    type: 'kitchen',
    tableNumber: applied.tableNumber,
    orderNumber: applied.item.orderId,
    items: [
      { name: `ANULAR: ${applied.item.itemName}`, quantity, notes: `Cambio · Motivo: ${reason}` },
      {
        name: `HACER: ${applied.created.itemName}`,
        quantity,
        notes: itemNotesForPrint(applied.created.modifiers, applied.created.notes),
        modifiers: modifierLines(applied.created.modifiers),
      },
    ],
  });
}

/** Al cobrar o anular la mesa, los pedidos de cambio pendientes se cierran solos. */
export async function rejectPendingChangesForOrders(tx: Tx, orderIds: number[], reason: string) {
  if (orderIds.length === 0) return;
  await tx.orderItemChange.updateMany({
    where: { orderId: { in: orderIds }, status: ItemChangeStatus.PENDING },
    data: { status: ItemChangeStatus.REJECTED, resolvedAt: new Date(), rejectReason: reason },
  });
}
