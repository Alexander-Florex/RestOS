// ──────────────────────────────────────────────
// inventory.service.ts — Lógica de inventario
//
// Costo del insumo (tareas 2.2 y 2.5):
// - Si tiene presentación de compra (ej. bolsa de 25 kg a $25.000), el costo
//   por unidad se calcula: precio / cantidad de la presentación pasada a la
//   unidad del insumo. Si no, se carga a mano.
// - Cada cambio de costo deja un registro en el historial de precios, con su
//   origen (a mano, compra/reposición o importación).
// ──────────────────────────────────────────────
import { InventoryCategory, PriceSource, Prisma, type InventoryItem } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';
import { audit, changedFields } from '../../lib/audit.js';
import { currentContext } from '../../lib/request-context.js';
import { convertUnits, FAMILY_LABEL, normalizeUnit, unitFamily, UnitError, UNIT_LIST } from '../../shared/units.js';
import { applyMovement, lockItem } from '../../lib/stock.js';

function emitChanged(restaurantId: number, item: InventoryItem) { ioRestaurant(restaurantId).emit(SocketEvents.INVENTORY_ITEM_CHANGED, item); }
function emitCreated(restaurantId: number, item: InventoryItem) { ioRestaurant(restaurantId).emit(SocketEvents.INVENTORY_ITEM_CREATED, item); }
function emitDeleted(restaurantId: number, id: number)          { ioRestaurant(restaurantId).emit(SocketEvents.INVENTORY_ITEM_DELETED, { id }); }

type Tx = Prisma.TransactionClient;

export interface CreateInventoryData {
  name: string;
  category: InventoryCategory;
  quantity: number;
  unit: string;
  minStock?: number;
  /** A mano. Se ignora si el insumo tiene presentación de compra (el costo se calcula). */
  costPerUnit?: number;
  supplier?: string;
  /** "1 <unit> = equivalenceQty <equivalenceUnit>" (otra familia). null = quitarla */
  equivalenceQty?: number | null;
  equivalenceUnit?: string | null;
  /** Presentación de compra (ej. 25 kg a $25.000). null en los tres = quitarla */
  purchaseQty?: number | null;
  purchaseUnit?: string | null;
  purchasePrice?: number | null;
  /** Merma por defecto al usarlo en recetas, 0–0,95 */
  wastePct?: number;
  /** Sector de guardado (tarea 3.1); null = sin sector */
  storageAreaId?: number | null;
  /** Orden dentro del sector para el conteo */
  countOrder?: number;
}

/** La cantidad no se edita: cambia solo con movimientos (reponer, consumir, ajustar, contar). */
export interface UpdateInventoryData extends Partial<Omit<CreateInventoryData, 'quantity'>> {}

export interface RestockOptions {
  /** Cantidad en la unidad del insumo... */
  amount?: number;
  /** ...o cantidad de presentaciones (ej. 2 bolsas) */
  presentations?: number;
  /** Precio nuevo de la presentación (llegó la mercadería más cara/barata) */
  purchasePrice?: number;
}

const VALID_UNITS = UNIT_LIST.join(', ');

/** Unidad del insumo normalizada ("Grs" → "g"); rechaza las que no se pueden convertir. */
function unitOrFail(raw: string): string {
  const unit = normalizeUnit(raw);
  if (!unit) throw HttpError.badRequest(`Unidad no reconocida: "${raw}". Usá una de: ${VALID_UNITS}`);
  return unit;
}

/**
 * Valida la equivalencia contra la unidad (final) del insumo. Devuelve los
 * valores a guardar, o undefined si no se tocó.
 */
function equivalenceOrFail(itemUnit: string, qty: number | null | undefined, rawUnit: string | null | undefined) {
  if (qty === undefined && rawUnit === undefined) return undefined;
  if (qty === null || rawUnit === null || rawUnit === '') return { equivalenceQty: null, equivalenceUnit: null };
  const unit = normalizeUnit(itemUnit);
  if (!unit) throw HttpError.badRequest(`Corregí primero la unidad del insumo ("${itemUnit}") para cargar una equivalencia`);
  const eqUnit = rawUnit ? normalizeUnit(rawUnit) : null;
  if (!eqUnit) throw HttpError.badRequest(`Unidad de la equivalencia no reconocida. Usá una de: ${VALID_UNITS}`);
  if (!(qty !== undefined && qty > 0)) throw HttpError.badRequest('La equivalencia tiene que ser mayor a 0');
  if (unitFamily(eqUnit) === unitFamily(unit)) {
    throw HttpError.badRequest(`La equivalencia tiene que ser de otra familia (el insumo ya está en ${FAMILY_LABEL[unitFamily(unit)]})`);
  }
  return { equivalenceQty: qty, equivalenceUnit: eqUnit };
}

/** El sector tiene que ser del mismo restaurante. */
async function areaOrFail(restaurantId: number, areaId: number | null | undefined) {
  if (areaId === undefined || areaId === null) return areaId;
  const area = await prisma.storageArea.findFirst({ where: { id: areaId, restaurantId }, select: { id: true } });
  if (!area) throw HttpError.badRequest('Sector no encontrado');
  return areaId;
}

function wasteOrFail(waste: number | undefined) {
  if (waste === undefined) return undefined;
  if (!(waste >= 0 && waste <= 0.95)) throw HttpError.badRequest('La merma tiene que estar entre 0 % y 95 %');
  return waste;
}

interface Presentation { purchaseQty: number | null; purchaseUnit: string | null; purchasePrice: number | null }

/** Costo por unidad del insumo a partir de la presentación (4 decimales, como la columna). */
export function presentationCostPerUnit(
  item: { unit: string; equivalenceQty: number | null; equivalenceUnit: string | null },
  p: { purchaseQty: number; purchaseUnit: string; purchasePrice: number },
): number {
  let inItemUnit: number;
  try {
    inItemUnit = convertUnits(p.purchaseQty, p.purchaseUnit, item.unit, {
      itemUnit: item.unit,
      eq: item.equivalenceQty && item.equivalenceUnit ? { qty: item.equivalenceQty, unit: item.equivalenceUnit } : null,
    });
  } catch (err) {
    throw HttpError.badRequest(`Presentación: ${err instanceof UnitError ? err.message : 'unidad incompatible'}`);
  }
  if (!(inItemUnit > 0)) throw HttpError.badRequest('La presentación tiene que tener una cantidad mayor a 0');
  return Math.round((p.purchasePrice / inItemUnit) * 10_000) / 10_000;
}

/** Presentación final (lo que viene en `data` sobre lo guardado), validada. */
function presentationOrFail(data: UpdateInventoryData, current: Presentation | null): Presentation | undefined {
  const touched = data.purchaseQty !== undefined || data.purchaseUnit !== undefined || data.purchasePrice !== undefined;
  if (!touched) return undefined;
  const merged: Presentation = {
    purchaseQty: data.purchaseQty !== undefined ? data.purchaseQty : current?.purchaseQty ?? null,
    purchaseUnit: data.purchaseUnit !== undefined ? data.purchaseUnit : current?.purchaseUnit ?? null,
    purchasePrice: data.purchasePrice !== undefined ? data.purchasePrice : current?.purchasePrice ?? null,
  };
  const set = [merged.purchaseQty, merged.purchaseUnit, merged.purchasePrice].filter(v => v !== null && v !== '').length;
  if (set === 0) return { purchaseQty: null, purchaseUnit: null, purchasePrice: null };
  if (set < 3) throw HttpError.badRequest('La presentación necesita cantidad, unidad y precio (o dejá los tres vacíos)');
  if (!(merged.purchaseQty! > 0)) throw HttpError.badRequest('La cantidad de la presentación tiene que ser mayor a 0');
  if (!(merged.purchasePrice! >= 0)) throw HttpError.badRequest('El precio de la presentación no puede ser negativo');
  const unit = normalizeUnit(merged.purchaseUnit);
  if (!unit) throw HttpError.badRequest(`Unidad de la presentación no reconocida. Usá una de: ${VALID_UNITS}`);
  return { ...merged, purchaseUnit: unit };
}

/** Registra un cambio de costo en el historial (si de verdad cambió). */
async function recordPrice(
  tx: Tx,
  item: InventoryItem,
  previousCost: Prisma.Decimal | null,
  source: PriceSource,
) {
  if (previousCost !== null && previousCost.equals(item.costPerUnit)) return;
  const userId = currentContext()?.userId ?? null;
  const user = userId ? await tx.user.findUnique({ where: { id: userId }, select: { name: true } }) : null;
  await tx.priceHistory.create({
    data: {
      restaurantId: item.restaurantId,
      inventoryItemId: item.id,
      costPerUnit: item.costPerUnit,
      previousCost,
      unit: item.unit,
      purchaseQty: item.purchaseQty,
      purchaseUnit: item.purchaseUnit,
      purchasePrice: item.purchasePrice,
      source,
      userId: user ? userId : null,
      userName: user?.name ?? null,
    },
  });
}

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

  /** Historial de costos del insumo, del más nuevo al más viejo. */
  async priceHistory(restaurantId: number, id: number) {
    await inventoryService.getById(restaurantId, id);
    return prisma.priceHistory.findMany({
      where: { restaurantId, inventoryItemId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
  },

  async create(restaurantId: number, data: CreateInventoryData, source: PriceSource = PriceSource.MANUAL): Promise<InventoryItem> {
    if (data.quantity < 0) throw HttpError.badRequest('La cantidad no puede ser negativa');
    if (data.minStock !== undefined && data.minStock < 0) {
      throw HttpError.badRequest('El stock mínimo no puede ser negativo');
    }
    const unit = unitOrFail(data.unit);
    const equivalence = equivalenceOrFail(unit, data.equivalenceQty, data.equivalenceUnit);
    const presentation = presentationOrFail(data, null);
    const wastePct = wasteOrFail(data.wastePct);
    const storageAreaId = await areaOrFail(restaurantId, data.storageAreaId);
    const costPerUnit = presentation?.purchaseQty
      ? presentationCostPerUnit(
          { unit, equivalenceQty: equivalence?.equivalenceQty ?? null, equivalenceUnit: equivalence?.equivalenceUnit ?? null },
          presentation as { purchaseQty: number; purchaseUnit: string; purchasePrice: number },
        )
      : data.costPerUnit ?? 0;

    const item = await prisma.$transaction(async (tx) => {
      // Se crea en 0: la cantidad inicial entra como movimiento "saldo inicial"
      const created = await tx.inventoryItem.create({
        data: {
          restaurantId,
          name: data.name,
          category: data.category,
          quantity: 0,
          unit,
          ...equivalence,
          ...(presentation ?? {}),
          ...(wastePct !== undefined ? { wastePct } : {}),
          ...(storageAreaId !== undefined ? { storageAreaId } : {}),
          ...(data.countOrder !== undefined ? { countOrder: data.countOrder } : {}),
          minStock: data.minStock ?? 0,
          costPerUnit,
          supplier: data.supplier ?? null,
          lastRestocked: data.quantity > 0 ? new Date() : null,
        },
      });
      if (costPerUnit > 0) await recordPrice(tx, created, null, source);
      if (data.quantity > 0) {
        const locked = await lockItem(tx, restaurantId, created.id);
        await applyMovement(tx, locked!, { type: 'ADJUSTMENT', delta: data.quantity, reason: 'Saldo inicial' });
        return tx.inventoryItem.findUniqueOrThrow({ where: { id: created.id } });
      }
      return created;
    });
    emitCreated(restaurantId, item);
    return item;
  },

  async update(restaurantId: number, id: number, data: UpdateInventoryData, source: PriceSource = PriceSource.MANUAL): Promise<InventoryItem> {
    const current = await inventoryService.getById(restaurantId, id);
    if (data.minStock !== undefined && data.minStock < 0) {
      throw HttpError.badRequest('El stock mínimo no puede ser negativo');
    }
    const unit = data.unit !== undefined ? unitOrFail(data.unit) : current.unit;
    const equivalence = equivalenceOrFail(unit, data.equivalenceQty, data.equivalenceUnit);
    // Si cambia la unidad a la misma familia que la equivalencia guardada, la equivalencia ya no tiene sentido
    if (equivalence === undefined && data.unit !== undefined && current.equivalenceUnit) {
      const eqUnit = normalizeUnit(current.equivalenceUnit);
      const newUnit = normalizeUnit(unit);
      if (eqUnit && newUnit && unitFamily(eqUnit) === unitFamily(newUnit)) {
        throw HttpError.badRequest('La nueva unidad es de la misma familia que la equivalencia: quitá o cambiá la equivalencia');
      }
    }
    const presentation = presentationOrFail(data, {
      purchaseQty: current.purchaseQty, purchaseUnit: current.purchaseUnit,
      purchasePrice: current.purchasePrice !== null ? Number(current.purchasePrice) : null,
    });
    const wastePct = wasteOrFail(data.wastePct);
    const storageAreaId = await areaOrFail(restaurantId, data.storageAreaId);

    // Costo final: si (después del cambio) hay presentación, se calcula; si no, el que venga a mano
    const finalPresentation = presentation ?? (current.purchaseQty !== null
      ? { purchaseQty: current.purchaseQty, purchaseUnit: current.purchaseUnit, purchasePrice: Number(current.purchasePrice) }
      : null);
    const finalEq = equivalence ?? { equivalenceQty: current.equivalenceQty, equivalenceUnit: current.equivalenceUnit };
    const derivedCost = finalPresentation?.purchaseQty
      ? presentationCostPerUnit({ unit, ...finalEq }, finalPresentation as { purchaseQty: number; purchaseUnit: string; purchasePrice: number })
      : undefined;
    const costPerUnit = derivedCost ?? data.costPerUnit;

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.inventoryItem.update({
        where: { id },
        data: {
          ...(equivalence ?? {}),
          ...(presentation ?? {}),
          ...(wastePct !== undefined ? { wastePct } : {}),
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.category !== undefined ? { category: data.category } : {}),
          ...(storageAreaId !== undefined ? { storageAreaId } : {}),
          ...(data.countOrder !== undefined ? { countOrder: data.countOrder } : {}),
          ...(data.unit !== undefined ? { unit } : {}),
          ...(data.minStock !== undefined ? { minStock: data.minStock } : {}),
          ...(costPerUnit !== undefined ? { costPerUnit } : {}),
          ...(data.supplier !== undefined ? { supplier: data.supplier } : {}),
        },
      });
      await recordPrice(tx, updated, current.costPerUnit, source);
      // Costo o mínimo cambiados a mano: quedan registrados (la cantidad va por movimientos)
      const diff = changedFields(
        { costPerUnit: String(current.costPerUnit), minStock: current.minStock },
        { costPerUnit: String(updated.costPerUnit), minStock: updated.minStock },
        ['costPerUnit', 'minStock'],
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

  /**
   * Reabastece: suma al stock (en la unidad del insumo o en presentaciones) y,
   * si llegó con otro precio, actualiza el costo (historial con origen "compra").
   */
  async restock(restaurantId: number, id: number, input: number | RestockOptions): Promise<InventoryItem> {
    const opts: RestockOptions = typeof input === 'number' ? { amount: input } : input;
    const current = await inventoryService.getById(restaurantId, id);

    let amount = opts.amount;
    if (opts.presentations !== undefined) {
      if (!current.purchaseQty || !current.purchaseUnit) {
        throw HttpError.badRequest('Este insumo no tiene presentación de compra cargada');
      }
      if (!(opts.presentations > 0)) throw HttpError.badRequest('La cantidad de presentaciones debe ser mayor a 0');
      try {
        amount = convertUnits(opts.presentations * current.purchaseQty, current.purchaseUnit, current.unit, {
          itemUnit: current.unit,
          eq: current.equivalenceQty && current.equivalenceUnit ? { qty: current.equivalenceQty, unit: current.equivalenceUnit } : null,
        });
      } catch (err) {
        throw HttpError.badRequest(err instanceof UnitError ? err.message : 'Presentación incompatible');
      }
    }
    if (amount === undefined || !(amount > 0)) throw HttpError.badRequest('La cantidad a reabastecer debe ser mayor a 0');
    if (opts.purchasePrice !== undefined && !current.purchaseQty) {
      throw HttpError.badRequest('Para cargar el precio de compra, primero definí la presentación del insumo');
    }
    const newCost = opts.purchasePrice !== undefined
      ? presentationCostPerUnit(current, {
          purchaseQty: current.purchaseQty!, purchaseUnit: current.purchaseUnit!, purchasePrice: opts.purchasePrice,
        })
      : undefined;

    // Fila bloqueada: dos reposiciones simultáneas quedan en fila y no se pisan
    const qty = amount;
    const item = await prisma.$transaction(async (tx) => {
      const locked = await lockItem(tx, restaurantId, id);
      if (!locked) throw HttpError.notFound('Ítem de inventario no encontrado');
      await applyMovement(tx, locked, {
        type: 'PURCHASE', delta: qty,
        unitCost: newCost ?? locked.costPerUnit,
        reference: opts.presentations !== undefined ? `${opts.presentations} × ${current.purchaseQty} ${current.purchaseUnit}` : null,
      });
      const updated = await tx.inventoryItem.update({
        where: { id },
        data: {
          lastRestocked: new Date(),
          ...(newCost !== undefined ? { costPerUnit: newCost, purchasePrice: opts.purchasePrice } : {}),
        },
      });
      if (newCost !== undefined) await recordPrice(tx, updated, current.costPerUnit, PriceSource.PURCHASE);
      await audit(tx, {
        restaurantId, action: 'inventory.restock', entity: 'InventoryItem', entityId: id,
        before: { name: updated.name, quantity: updated.quantity - qty, unit: updated.unit, ...(newCost !== undefined ? { costPerUnit: current.costPerUnit } : {}) },
        after: {
          quantity: updated.quantity, amount: qty,
          ...(opts.presentations !== undefined ? { presentations: opts.presentations } : {}),
          ...(newCost !== undefined ? { costPerUnit: updated.costPerUnit, purchasePrice: opts.purchasePrice } : {}),
        },
      });
      return updated;
    });
    emitChanged(restaurantId, item);
    return item;
  },

  /** Consume: resta `amount`. Rechaza consumir más de lo que hay en vez de dejar el stock en 0 a escondidas. */
  async consume(restaurantId: number, id: number, amount: number, reason?: string | null): Promise<InventoryItem> {
    if (amount <= 0) throw HttpError.badRequest('La cantidad a consumir debe ser mayor a 0');
    const item = await prisma.$transaction(async (tx) => {
      const locked = await lockItem(tx, restaurantId, id);
      if (!locked) throw HttpError.notFound('Ítem de inventario no encontrado');
      if (locked.quantity + 1e-9 < amount) {
        throw HttpError.badRequest(`No hay stock suficiente de "${locked.name}" (quedan ${locked.quantity} ${locked.unit})`);
      }
      const before = locked.quantity;
      await applyMovement(tx, locked, { type: 'CONSUMPTION', delta: -amount, reason: reason ?? null });
      const updated = await tx.inventoryItem.findUniqueOrThrow({ where: { id } });
      await audit(tx, {
        restaurantId, action: 'inventory.consume', entity: 'InventoryItem', entityId: id,
        before: { name: updated.name, quantity: before, unit: updated.unit },
        after: { quantity: updated.quantity, amount },
        reason: reason ?? null,
      });
      return updated;
    });
    emitChanged(restaurantId, item);
    return item;
  },

  /**
   * Ajuste a mano (tarea 3.2): fija la cantidad real y registra la diferencia
   * como movimiento con motivo obligatorio. Reemplaza editar la cantidad.
   */
  async adjust(restaurantId: number, id: number, quantity: number, reason: string): Promise<InventoryItem> {
    if (!(quantity >= 0)) throw HttpError.badRequest('La cantidad no puede ser negativa');
    const why = reason.trim();
    if (why.length < 3) throw HttpError.badRequest('Escribí el motivo del ajuste');
    const item = await prisma.$transaction(async (tx) => {
      const locked = await lockItem(tx, restaurantId, id);
      if (!locked) throw HttpError.notFound('Ítem de inventario no encontrado');
      const before = locked.quantity;
      const delta = quantity - before;
      if (Math.abs(delta) < 1e-9) throw HttpError.badRequest(`"${locked.name}" ya tiene ${before} ${locked.unit}`);
      await applyMovement(tx, locked, { type: 'ADJUSTMENT', delta, reason: why });
      const updated = await tx.inventoryItem.findUniqueOrThrow({ where: { id } });
      await audit(tx, {
        restaurantId, action: 'inventory.adjust', entity: 'InventoryItem', entityId: id,
        before: { name: updated.name, quantity: before, unit: updated.unit },
        after: { quantity: updated.quantity, difference: updated.quantity - before },
        reason: why,
      });
      return updated;
    });
    emitChanged(restaurantId, item);
    return item;
  },

  /** Movimientos del insumo, del más nuevo al más viejo. */
  async movements(restaurantId: number, id: number, limit = 200) {
    await inventoryService.getById(restaurantId, id);
    return prisma.stockMovement.findMany({
      where: { restaurantId, inventoryItemId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 500),
    });
  },
};
