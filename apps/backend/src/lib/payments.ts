// ──────────────────────────────────────────────
// payments.ts — Cómo se paga una cuenta (tarea 5.2)
//
// Una cuenta se puede pagar con varios medios o dividirse entre comensales.
// Reglas (siempre se cobra el total):
//  - tarjeta y transferencia no pueden pagar de más (no hay vuelto en esos medios);
//  - el efectivo cubre lo que falta y es el único que da vuelto;
//  - cada parte con monto mayor a cero, salvo una cuenta en $0 (invita la casa).
// Todo en centavos para no arrastrar errores de punto flotante.
// ──────────────────────────────────────────────
import { PaymentMethod } from '@prisma/client';
import { HttpError } from './http-error.js';
import { formatCents, toCents } from './money.js';

export interface PaymentPart { method: PaymentMethod; amount: number }

export interface SettledPayments {
  /** Lo que se guarda en sale_payments */
  rows: Array<{ method: PaymentMethod; amountCents: number; tenderedCents: number | null }>;
  /** Lo entregado en total (incluye el vuelto) */
  tenderedCents: number;
  /** CASH/CARD/TRANSFER si es uno solo; MIXED si son varios */
  method: PaymentMethod;
  changeCents: number;
}

const ALLOWED: PaymentMethod[] = [PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.TRANSFER];

/** Valida la forma (antes de bloquear nada). */
export function checkParts(parts: PaymentPart[]): void {
  if (parts.length === 0) throw HttpError.badRequest('Indicá cómo se paga');
  if (parts.length > 20) throw HttpError.badRequest('Demasiadas partes de pago');
  for (const p of parts) {
    if (!ALLOWED.includes(p.method)) throw HttpError.badRequest('Cada parte se paga en efectivo, tarjeta o transferencia');
    const c = toCents(p.amount);
    if (!Number.isFinite(c) || c < 0) throw HttpError.badRequest('Los montos no pueden ser negativos');
    if (parts.length > 1 && c === 0) throw HttpError.badRequest('Cada parte del pago tiene que tener un monto');
  }
}

/** Reparte el pago contra el total de la cuenta. Lanza 400 si no alcanza o si paga de más con tarjeta. */
export function settlePayments(parts: PaymentPart[], totalCents: number): SettledPayments {
  checkParts(parts);
  const nonCash = parts.filter(p => p.method !== PaymentMethod.CASH);
  const cash = parts.filter(p => p.method === PaymentMethod.CASH);
  const nonCashCents = nonCash.reduce((s, p) => s + toCents(p.amount), 0);
  const cashCents = cash.reduce((s, p) => s + toCents(p.amount), 0);

  if (nonCashCents > totalCents) {
    throw HttpError.badRequest(
      `Con tarjeta o transferencia se paga como mucho el total (${formatCents(totalCents)}): no dan vuelto`,
    );
  }
  const remaining = totalCents - nonCashCents;
  if (cashCents < remaining) {
    throw HttpError.badRequest(
      `El pago (${formatCents(nonCashCents + cashCents)}) no cubre el total de la cuenta (${formatCents(totalCents)}). ` +
      'Si se agregaron pedidos, revisá la cuenta y volvé a cobrar.',
    );
  }

  const rows: SettledPayments['rows'] = nonCash.map(p => ({ method: p.method, amountCents: toCents(p.amount), tenderedCents: null }));
  // El efectivo cubre lo que falta, en orden; lo que sobra es vuelto
  let left = remaining;
  for (const p of cash) {
    const tendered = toCents(p.amount);
    const applied = Math.min(tendered, left);
    left -= applied;
    rows.push({ method: PaymentMethod.CASH, amountCents: applied, tenderedCents: tendered });
  }
  const methods = new Set(parts.map(p => p.method));
  return {
    rows,
    tenderedCents: nonCashCents + cashCents,
    method: methods.size === 1 ? parts[0].method : PaymentMethod.MIXED,
    changeCents: cashCents - remaining,
  };
}

/** Descuento en centavos: por % (redondeado al centavo) o por monto. */
export function discountCents(subtotalCents: number, d: { pct?: number | null; amount?: number | null; reason?: string | null }): number {
  const hasPct = d.pct !== undefined && d.pct !== null;
  const hasAmount = d.amount !== undefined && d.amount !== null;
  if (!hasPct && !hasAmount) return 0;
  if (hasPct && hasAmount) throw HttpError.badRequest('El descuento va por porcentaje o por monto, no los dos');
  let cents: number;
  if (hasPct) {
    const pct = Number(d.pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw HttpError.badRequest('El descuento tiene que estar entre 0 y 100 %');
    cents = Math.round((subtotalCents * Math.round(pct * 100)) / 10_000);
  } else {
    cents = toCents(Number(d.amount));
    if (!Number.isFinite(cents) || cents < 0) throw HttpError.badRequest('El descuento no puede ser negativo');
    if (cents > subtotalCents) throw HttpError.badRequest('El descuento no puede ser mayor que la cuenta');
  }
  if (cents > 0 && (d.reason ?? '').trim().length < 3) throw HttpError.badRequest('Escribí el motivo del descuento');
  return cents;
}
