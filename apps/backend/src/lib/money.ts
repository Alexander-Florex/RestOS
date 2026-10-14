// ──────────────────────────────────────────────
// money.ts — Montos en centavos enteros
//
// Los montos se guardan como Decimal(10,2). Para sumar y comparar se pasan
// a centavos (enteros), así no se acumulan errores de float ni se comparan
// floats con === / <.
// ──────────────────────────────────────────────
import type { Prisma } from '@prisma/client';

type MoneyInput = number | string | Prisma.Decimal;

/** Convierte un monto en pesos a centavos enteros, redondeando a 2 decimales. */
export function toCents(value: MoneyInput): number {
  return Math.round(Number(value) * 100);
}

/** Convierte centavos a pesos (number con 2 decimales exactos para Prisma Decimal). */
export function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Monto efectivamente cobrado de una venta, en centavos.
 * `amount` es lo que entregó el cliente (con efectivo puede incluir el vuelto)
 * y `total` es lo que se debía: lo cobrado es el menor de los dos.
 */
export function collectedCents(sale: { amount: MoneyInput; total: MoneyInput }): number {
  return Math.min(toCents(sale.amount), toCents(sale.total));
}

/** Formato ARS para mensajes de error ("$ 12.345,50"). */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100);
}
