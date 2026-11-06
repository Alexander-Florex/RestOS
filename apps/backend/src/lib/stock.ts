// ──────────────────────────────────────────────
// stock.ts — Movimientos de stock (tarea 3.2)
//
// El stock de un insumo es la suma de sus movimientos. `inventory_items.quantity`
// guarda ese saldo para leerlo rápido y SOLO se cambia desde acá, en la misma
// transacción que el movimiento: así nunca quedan desfasados.
//
// La fila del insumo se bloquea (SELECT ... FOR UPDATE) antes de leer el saldo:
// dos movimientos simultáneos del mismo insumo quedan en fila y no se pisan.
// ──────────────────────────────────────────────
import { Prisma, type StockMovementType } from '@prisma/client';
import { currentContext } from './request-context.js';

type Tx = Prisma.TransactionClient;

export interface LockedItem {
  id: number;
  restaurantId: number;
  name: string;
  unit: string;
  quantity: number;
  costPerUnit: Prisma.Decimal | string;
}

/** Redondeo a 4 decimales: evita arrastrar basura de punto flotante en el saldo. */
export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * Bloquea el insumo y devuelve su saldo actual, o null si no existe en ese restaurante.
 * Tiene que ser la PRIMERA lectura de la transacción (ver lib/table-lock.ts).
 */
export async function lockItem(tx: Tx, restaurantId: number, id: number): Promise<LockedItem | null> {
  const rows = await tx.$queryRaw<LockedItem[]>`
    SELECT id, restaurantId, name, unit, quantity, costPerUnit
    FROM inventory_items
    WHERE id = ${id} AND restaurantId = ${restaurantId}
    FOR UPDATE`;
  const row = rows[0];
  return row ? { ...row, quantity: Number(row.quantity) } : null;
}

/** Bloquea varios insumos en orden de id (orden fijo: evita deadlocks entre conteos). */
export async function lockItems(tx: Tx, restaurantId: number, ids: number[]): Promise<Map<number, LockedItem>> {
  const map = new Map<number, LockedItem>();
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  if (sorted.length === 0) return map;
  const rows = await tx.$queryRaw<LockedItem[]>`
    SELECT id, restaurantId, name, unit, quantity, costPerUnit
    FROM inventory_items
    WHERE restaurantId = ${restaurantId} AND id IN (${Prisma.join(sorted)})
    ORDER BY id
    FOR UPDATE`;
  for (const r of rows) map.set(r.id, { ...r, quantity: Number(r.quantity) });
  return map;
}


export interface MovementInput {
  type: StockMovementType;
  /** Cantidad con signo, en la unidad del insumo */
  delta: number;
  reason?: string | null;
  reference?: string | null;
  stockCountId?: number | null;
  /** Por defecto, el costo actual del insumo */
  unitCost?: Prisma.Decimal | number | string | null;
}

/** Nombre del usuario del pedido en curso (se guarda copia, como en la auditoría). */
async function currentUser(tx: Tx): Promise<{ userId: number | null; userName: string | null }> {
  const userId = currentContext()?.userId ?? null;
  if (!userId) return { userId: null, userName: null };
  const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user ? { userId, userName: user.name } : { userId: null, userName: null };
}

/**
 * Registra un movimiento sobre un insumo YA bloqueado y actualiza su saldo.
 * Devuelve el saldo nuevo. Actualiza `item.quantity` en el objeto recibido,
 * para poder encadenar varios movimientos del mismo insumo.
 */
export async function applyMovement(tx: Tx, item: LockedItem, input: MovementInput): Promise<number> {
  const delta = round4(input.delta);
  const balanceAfter = round4(item.quantity + delta);
  await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: balanceAfter } });
  const { userId, userName } = await currentUser(tx);
  await tx.stockMovement.create({
    data: {
      restaurantId: item.restaurantId,
      inventoryItemId: item.id,
      type: input.type,
      quantity: delta,
      balanceAfter,
      unitCost: input.unitCost !== undefined ? input.unitCost : item.costPerUnit,
      reason: input.reason ?? null,
      reference: input.reference ?? null,
      stockCountId: input.stockCountId ?? null,
      userId,
      userName,
    },
  });
  item.quantity = balanceAfter;
  return balanceAfter;
}
