// ──────────────────────────────────────────────
// table-lock.ts — Bloqueo de fila de una mesa dentro de una transacción
//
// Cobro y alta de pedidos de una misma mesa deben quedar en fila: si no,
// dos cobros simultáneos generan dos ventas, o un pedido que entra en medio
// de un cobro queda huérfano en una mesa ya cerrada.
//
// SELECT ... FOR UPDATE lee la última versión confirmada y retiene la fila
// hasta el commit/rollback. Tiene que ser la PRIMERA lectura de la
// transacción: en InnoDB (REPEATABLE READ) la foto de las lecturas normales
// se toma en la primera lectura no bloqueante, así queda posterior al lock.
// ──────────────────────────────────────────────
import { Prisma, type TableStatus } from '@prisma/client';

export interface LockedTable {
  id: number;
  number: number;
  name: string | null;
  groupId: number | null;
  status: TableStatus;
  capacity: number;
  enabled: boolean;
}

/** Bloquea la mesa y devuelve su estado actual, o null si no existe en ese restaurante. */
export async function lockTable(
  tx: Prisma.TransactionClient,
  restaurantId: number,
  tableId: number,
): Promise<LockedTable | null> {
  const rows = await tx.$queryRaw<LockedTable[]>`
    SELECT id, number, name, groupId, status, capacity, enabled
    FROM tables
    WHERE id = ${tableId} AND restaurantId = ${restaurantId}
    FOR UPDATE`;
  const row = rows[0];
  if (!row) return null;
  // MySQL devuelve el booleano como 0/1 en consultas crudas
  return { ...row, enabled: Boolean(Number(row.enabled)) };
}

/**
 * Bloquea varias mesas (mesas unidas) en UNA consulta, en orden de id: dos operaciones
 * que bloquean grupos que se cruzan esperan en fila en vez de trabarse (deadlock).
 * Incluye las mesas pedidas y todas las del grupo `groupId`, si se pasa.
 * Igual que lockTable, tiene que ser la primera lectura de la transacción.
 */
export async function lockTables(
  tx: Prisma.TransactionClient,
  restaurantId: number,
  ids: number[],
  groupId: number | null = null,
): Promise<LockedTable[]> {
  if (ids.length === 0 && groupId === null) return [];
  const idList = ids.length ? Prisma.join(ids) : Prisma.sql`NULL`;
  const rows = await tx.$queryRaw<LockedTable[]>`
    SELECT id, number, name, groupId, status, capacity, enabled
    FROM tables
    WHERE restaurantId = ${restaurantId}
      AND (id IN (${idList}) ${groupId !== null ? Prisma.sql`OR groupId = ${groupId}` : Prisma.empty})
    ORDER BY id
    FOR UPDATE`;
  return rows.map(r => ({ ...r, enabled: Boolean(Number(r.enabled)) }));
}

/**
 * Cambios de grupo cuando unas mesas salen de él (se cobran, se liberan o se separan).
 * `group` son TODAS las mesas del grupo, ya bloqueadas. Mantiene dos reglas:
 *  - un grupo tiene al menos dos mesas (si queda una sola, deja de estar unida);
 *  - el groupId es el id de una mesa del grupo (si se va esa, pasa a la de menor id),
 *    así una mesa que después arma otro grupo nunca reusa el número de uno existente.
 */
export function groupUpdatesAfterLeaving(
  group: Array<{ id: number; groupId: number | null }>,
  leavingIds: number[],
): Array<{ ids: number[]; groupId: number | null }> {
  const leaving = new Set(leavingIds);
  const key = group[0]?.groupId ?? null;
  const stay = group.filter(t => !leaving.has(t.id)).map(t => t.id).sort((a, b) => a - b);
  const updates: Array<{ ids: number[]; groupId: number | null }> = [];
  const gone = group.filter(t => leaving.has(t.id)).map(t => t.id);
  if (gone.length) updates.push({ ids: gone, groupId: null });
  if (stay.length === 1) updates.push({ ids: stay, groupId: null });
  else if (stay.length >= 2 && key !== null && !stay.includes(key)) updates.push({ ids: stay, groupId: stay[0] });
  return updates;
}
