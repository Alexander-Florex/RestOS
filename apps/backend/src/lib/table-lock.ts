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
import type { Prisma, TableStatus } from '@prisma/client';

export interface LockedTable {
  id: number;
  number: number;
  status: TableStatus;
  capacity: number;
}

/** Bloquea la mesa y devuelve su estado actual, o null si no existe en ese restaurante. */
export async function lockTable(
  tx: Prisma.TransactionClient,
  restaurantId: number,
  tableId: number,
): Promise<LockedTable | null> {
  const rows = await tx.$queryRaw<LockedTable[]>`
    SELECT id, number, status, capacity
    FROM tables
    WHERE id = ${tableId} AND restaurantId = ${restaurantId}
    FOR UPDATE`;
  return rows[0] ?? null;
}
