// ──────────────────────────────────────────────
// audit.ts — Registro de auditoría (tarea 1.2)
//
// Quién hizo qué, sobre qué, con qué valores antes/después y por qué.
// Se escribe con el MISMO cliente de la transacción de la operación: si la
// operación se revierte, el registro también (no quedan registros de cosas
// que no pasaron, ni operaciones sin registro).
// Nunca guarda contraseñas: las claves sensibles se tapan.
// ──────────────────────────────────────────────
import type { Prisma, PrismaClient } from '@prisma/client';
import { currentContext } from './request-context.js';
import { sanitize } from './logger.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** Acciones registradas. Agregar acá (y su etiqueta en el frontend) al sumar una nueva. */
export const AUDIT_ACTIONS = [
  'sale.create',        // cobro de mesa
  'takeaway.pay',       // cobro de para llevar
  'takeaway.cancel',    // cancelación de para llevar
  'order.cancel',       // anulación de pedido (con motivo)
  'order.item.remake',  // plato rehecho (se cobra una vez; pérdida)
  'order.item.replace', // plato cambiado por otro (el original no se cobra)
  'order.item.reject',  // pedido de cambio rechazado por caja
  'menu.price',         // cambio de precio de un plato
  'menu.options',       // cambio de opciones/recargos de un plato
  'menu.delete',        // plato borrado
  'inventory.restock',  // reposición de stock
  'inventory.consume',  // consumo/baja de stock
  'inventory.update',   // cambio de cantidad o costo a mano
  'inventory.delete',   // insumo borrado
  'inventory.adjust',   // cantidad corregida a mano, con motivo (tarea 3.2)
  'inventory.count.close',  // toma de inventario cerrada (tarea 3.3)
  'inventory.count.cancel', // toma de inventario descartada
  'user.create',
  'user.update',
  'user.toggle',        // activar / desactivar
  'user.delete',
  'role.create',
  'role.update',
  'role.delete',
  'staff.shift.create',  // turno cargado a mano (entrada y salida)
  'staff.shift.update',  // turno corregido
  'staff.shift.delete',  // turno borrado
  'staff.rate',          // cambio del valor por hora
  'account.payment',        // cobro de cuenta corriente (con recargo)
  'account.payment.cancel', // cobro de cuenta corriente anulado (con motivo)
] as const;

export type AuditAction = typeof AUDIT_ACTIONS[number];

export interface AuditEntry {
  restaurantId: number;
  action: AuditAction;
  entity: string;
  entityId?: number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  /** Por defecto, el usuario del pedido HTTP en curso. */
  userId?: number | null;
}

/** JSON plano y seguro: Decimal → string, fechas → ISO, sin contraseñas. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return sanitize(JSON.parse(JSON.stringify(value))) as Prisma.InputJsonValue;
}

export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  const userId = entry.userId !== undefined ? entry.userId : currentContext()?.userId ?? null;
  // Nombre del momento: si después borran al usuario, el registro sigue diciendo quién fue
  const user = userId ? await db.user.findUnique({ where: { id: userId }, select: { name: true } }) : null;
  await db.auditLog.create({
    data: {
      restaurantId: entry.restaurantId,
      userId: user ? userId : null,
      userName: user?.name ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: entry.reason ?? null,
    },
  });
}

/** Solo los campos que cambiaron, para no llenar el registro de ruido. */
export function changedFields<T extends Record<string, unknown>>(before: T, after: T, keys: (keyof T)[]) {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
