// ──────────────────────────────────────────────
// stock-counts.service.ts — Toma de inventario (tarea 3.3)
//
// 1. Se abre un conteo de un sector (o de todo): se copian sus insumos como
//    líneas, en el orden del sector (el de la planilla del cliente).
// 2. Cada número se guarda en el momento (desde uno o varios celulares).
//    Mientras está abierto NO se muestra lo que dice el sistema: conteo a ciegas.
// 3. Al cerrar se compara contra el stock del sistema EN ESE MOMENTO y cada
//    diferencia genera un movimiento COUNT. Lo que no se contó se saltea
//    (no se pone en 0). Todo en una transacción: o se aplica entero o nada.
// ──────────────────────────────────────────────
import { Prisma, type StockCount } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/request-context.js';
import { applyMovement, lockItems, round4 } from '../../lib/stock.js';

type Tx = Prisma.TransactionClient;

const ALL_LABEL = 'Todo el stock';
/** Diferencias menores a esto se consideran iguales (ruido de decimales). */
const EPS = 1e-4;

function emitCount(restaurantId: number, countId: number) {
  ioRestaurant(restaurantId).emit(SocketEvents.STOCK_COUNT_CHANGED, { id: countId });
}

async function userName(db: Tx | typeof prisma): Promise<{ id: number | null; name: string | null }> {
  const id = currentContext()?.userId ?? null;
  if (!id) return { id: null, name: null };
  const u = await db.user.findUnique({ where: { id }, select: { name: true } });
  return u ? { id, name: u.name } : { id: null, name: null };
}

/** Bloquea el conteo (primera lectura de la transacción) y devuelve su estado. */
async function lockCount(tx: Tx, restaurantId: number, id: number) {
  const rows = await tx.$queryRaw<{ id: number; status: StockCount['status'] }[]>`
    SELECT id, status FROM stock_counts
    WHERE id = ${id} AND restaurantId = ${restaurantId}
    FOR UPDATE`;
  return rows[0] ?? null;
}

const money = (n: number) => Math.round(n * 100) / 100;

export const stockCountsService = {
  /** Historial de conteos (los abiertos primero), con un resumen de cada uno. */
  async list(restaurantId: number, limit = 50) {
    const counts = await prisma.stockCount.findMany({
      where: { restaurantId },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 200),
      include: { lines: { select: { countedQty: true, difference: true, unitCost: true } } },
    });
    return counts
      .map(({ lines, ...c }) => {
        const withDiff = lines.filter(l => l.difference !== null && Math.abs(l.difference) >= EPS);
        return {
          ...c,
          totalLines: lines.length,
          countedLines: lines.filter(l => l.countedQty !== null).length,
          differences: withDiff.length,
          differenceValue: money(withDiff.reduce((s, l) => s + l.difference! * Number(l.unitCost ?? 0), 0)),
        };
      })
      .sort((a, b) => Number(b.status === 'OPEN') - Number(a.status === 'OPEN'));
  },

  /** Abre un conteo de un sector (o de todo el stock si storageAreaId es null). */
  async create(restaurantId: number, data: { storageAreaId: number | null; notes?: string | null }) {
    const area = data.storageAreaId !== null
      ? await prisma.storageArea.findFirst({ where: { id: data.storageAreaId, restaurantId } })
      : null;
    if (data.storageAreaId !== null && !area) throw HttpError.badRequest('Sector no encontrado');

    const items = await prisma.inventoryItem.findMany({
      where: { restaurantId, ...(area ? { storageAreaId: area.id } : {}) },
      select: { id: true, name: true, unit: true, countOrder: true, storageArea: { select: { sortOrder: true } } },
    });
    if (items.length === 0) {
      throw HttpError.badRequest(area ? `El sector "${area.name}" no tiene insumos` : 'No hay insumos cargados');
    }
    // Orden de la planilla: sector, orden dentro del sector, nombre. Sin sector, al final.
    items.sort((a, b) =>
      (a.storageArea?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.storageArea?.sortOrder ?? Number.MAX_SAFE_INTEGER)
      || a.countOrder - b.countOrder
      || a.name.localeCompare(b.name, 'es'),
    );

    const who = await userName(prisma);
    try {
      const count = await prisma.$transaction(async (tx) => {
        // Un conteo de todo se pisa con cualquier conteo de sector, y viceversa.
        // (Dos del MISMO sector los frena el índice único de openKey.)
        const overlapping = await tx.stockCount.findFirst({
          where: { restaurantId, status: 'OPEN', ...(area ? { openKey: 'all' } : {}) },
          select: { areaName: true },
        });
        if (overlapping) {
          throw HttpError.conflict(`Ya hay un conteo abierto de "${overlapping.areaName}": cerralo o descartalo primero`);
        }
        return tx.stockCount.create({
          data: {
            restaurantId,
            storageAreaId: area?.id ?? null,
            areaName: area?.name ?? ALL_LABEL,
            openKey: area ? `area:${area.id}` : 'all',
            notes: data.notes?.trim() || null,
            startedById: who.id,
            startedByName: who.name,
            lines: {
              create: items.map((it, i) => ({
                inventoryItemId: it.id, itemName: it.name, unit: it.unit, position: i + 1,
              })),
            },
          },
        });
      });
      emitCount(restaurantId, count.id);
      return stockCountsService.get(restaurantId, count.id);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw HttpError.conflict(`Ya hay un conteo abierto de "${area?.name ?? ALL_LABEL}"`);
      }
      throw err;
    }
  },

  /** Conteo con sus líneas. Abierto: sin lo que dice el sistema (conteo a ciegas). */
  async get(restaurantId: number, id: number) {
    const count = await prisma.stockCount.findFirst({
      where: { id, restaurantId },
      include: {
        lines: {
          orderBy: { position: 'asc' },
          include: { inventoryItem: { select: { storageArea: { select: { name: true } } } } },
        },
      },
    });
    if (!count) throw HttpError.notFound('Conteo no encontrado');
    const open = count.status === 'OPEN';
    return {
      ...count,
      lines: count.lines.map(({ inventoryItem, ...l }) => ({
        ...l,
        areaName: inventoryItem?.storageArea?.name ?? null,
        ...(open ? { expectedQty: null, difference: null } : {}),
      })),
    };
  },

  /** Guarda lo contado de una línea (null = borrar el número). */
  async setLine(
    restaurantId: number, countId: number, lineId: number,
    data: { countedQty?: number | null; reason?: string | null },
  ) {
    if (data.countedQty !== undefined && data.countedQty !== null && !(data.countedQty >= 0)) {
      throw HttpError.badRequest('La cantidad no puede ser negativa');
    }
    const who = await userName(prisma);
    const line = await prisma.$transaction(async (tx) => {
      // Bloquea el conteo: si justo lo están cerrando, este número espera y después se rechaza
      const count = await lockCount(tx, restaurantId, countId);
      if (!count) throw HttpError.notFound('Conteo no encontrado');
      if (count.status !== 'OPEN') throw HttpError.conflict('Este conteo ya se cerró: no se puede modificar');
      const current = await tx.stockCountLine.findFirst({ where: { id: lineId, stockCountId: countId } });
      if (!current) throw HttpError.notFound('Línea no encontrada');
      return tx.stockCountLine.update({
        where: { id: lineId },
        data: {
          ...(data.countedQty !== undefined ? {
            countedQty: data.countedQty === null ? null : round4(data.countedQty),
            countedAt: data.countedQty === null ? null : new Date(),
            countedByName: data.countedQty === null ? null : who.name,
          } : {}),
          ...(data.reason !== undefined ? { reason: data.reason?.trim() || null } : {}),
        },
      });
    });
    emitCount(restaurantId, countId);
    return line;
  },

  /** Vista previa del cierre: diferencias contra el stock actual, sin aplicar nada. */
  async summary(restaurantId: number, id: number) {
    const count = await prisma.stockCount.findFirst({
      where: { id, restaurantId },
      include: {
        lines: {
          orderBy: { position: 'asc' },
          include: { inventoryItem: { select: { quantity: true, costPerUnit: true } } },
        },
      },
    });
    if (!count) throw HttpError.notFound('Conteo no encontrado');
    if (count.status !== 'OPEN') throw HttpError.conflict('Este conteo ya no está abierto');
    const diffs = [];
    let uncounted = 0;
    let value = 0;
    for (const l of count.lines) {
      if (l.countedQty === null || !l.inventoryItem) { uncounted++; continue; }
      const expected = l.inventoryItem.quantity;
      const difference = round4(l.countedQty - expected);
      if (Math.abs(difference) < EPS) continue;
      const unitCost = Number(l.inventoryItem.costPerUnit);
      value += difference * unitCost;
      diffs.push({
        lineId: l.id, itemName: l.itemName, unit: l.unit, countedQty: l.countedQty,
        expectedQty: expected, difference, value: money(difference * unitCost), reason: l.reason,
      });
    }
    return {
      totalLines: count.lines.length,
      countedLines: count.lines.length - uncounted,
      uncounted,
      differences: diffs,
      differenceValue: money(value),
    };
  },

  /**
   * Cierra el conteo: compara lo contado con el stock del sistema en este
   * momento y genera un movimiento COUNT por cada diferencia. Cerrar dos veces
   * (doble toque, dos celulares) da 409: el conteo se bloquea primero.
   */
  async close(restaurantId: number, id: number, data: { notes?: string | null }) {
    const who = await userName(prisma);
    const result = await prisma.$transaction(async (tx) => {
      const count = await lockCount(tx, restaurantId, id);
      if (!count) throw HttpError.notFound('Conteo no encontrado');
      if (count.status !== 'OPEN') throw HttpError.conflict('Este conteo ya se cerró o se descartó');

      const header = await tx.stockCount.findUniqueOrThrow({ where: { id } });
      const lines = await tx.stockCountLine.findMany({ where: { stockCountId: id }, orderBy: { position: 'asc' } });
      const counted = lines.filter(l => l.countedQty !== null && l.inventoryItemId !== null);
      const items = await lockItems(tx, restaurantId, counted.map(l => l.inventoryItemId!));
      const notes = data.notes !== undefined ? (data.notes?.trim() || null) : header.notes;

      const changed: number[] = [];
      let differences = 0;
      let value = 0;
      for (const line of counted) {
        const item = items.get(line.inventoryItemId!);
        if (!item) continue; // el insumo se borró mientras se contaba
        const expected = item.quantity;
        const difference = round4(line.countedQty! - expected);
        const unitCost = item.costPerUnit;
        await tx.stockCountLine.update({
          where: { id: line.id },
          data: { expectedQty: expected, difference, unitCost },
        });
        if (Math.abs(difference) < EPS) continue;
        await applyMovement(tx, item, {
          type: 'COUNT', delta: difference, unitCost,
          reason: line.reason ?? notes ?? 'Toma de inventario',
          reference: `Conteo #${id} · ${header.areaName}`.slice(0, 100),
          stockCountId: id,
        });
        changed.push(item.id);
        differences++;
        value += difference * Number(unitCost);
      }

      const closed = await tx.stockCount.update({
        where: { id },
        data: { status: 'CLOSED', openKey: null, closedAt: new Date(), closedById: who.id, closedByName: who.name, notes },
      });
      const summary = {
        area: header.areaName,
        totalLines: lines.length,
        countedLines: counted.length,
        differences,
        differenceValue: money(value),
      };
      await audit(tx, {
        restaurantId, action: 'inventory.count.close', entity: 'StockCount', entityId: id,
        after: summary, reason: notes,
      });
      return { closed, changed, summary };
    }, { timeout: 60_000, maxWait: 10_000 });

    // Avisos en vivo: cada insumo corregido y el conteo
    if (result.changed.length > 0) {
      const updated = await prisma.inventoryItem.findMany({ where: { id: { in: result.changed } } });
      for (const item of updated) ioRestaurant(restaurantId).emit(SocketEvents.INVENTORY_ITEM_CHANGED, item);
    }
    emitCount(restaurantId, id);
    return { count: result.closed, summary: result.summary };
  },

  /** Descarta un conteo abierto: no cambia el stock. */
  async cancel(restaurantId: number, id: number, reason?: string | null) {
    const who = await userName(prisma);
    const count = await prisma.$transaction(async (tx) => {
      const locked = await lockCount(tx, restaurantId, id);
      if (!locked) throw HttpError.notFound('Conteo no encontrado');
      if (locked.status !== 'OPEN') throw HttpError.conflict('Este conteo ya se cerró o se descartó');
      const c = await tx.stockCount.update({
        where: { id },
        data: { status: 'CANCELLED', openKey: null, closedAt: new Date(), closedById: who.id, closedByName: who.name },
      });
      await audit(tx, {
        restaurantId, action: 'inventory.count.cancel', entity: 'StockCount', entityId: id,
        before: { area: c.areaName }, reason: reason?.trim() || null,
      });
      return c;
    });
    emitCount(restaurantId, id);
    return count;
  },
};
