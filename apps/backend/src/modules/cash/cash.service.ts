// ──────────────────────────────────────────────
// cash.service.ts — Caja (tarea 5.1)
//
// Una sola caja por local. Se abre con el monto inicial, se registran ingresos y
// egresos de efectivo que no son ventas, y se cierra contando el efectivo: la
// diferencia con lo esperado queda registrada (y en Auditoría).
//
// La caja cubre lo cobrado desde el cierre anterior hasta su propio cierre
// (periodStart → closedAt). Así un cobro hecho con la caja cerrada no se pierde:
// entra en la siguiente. Cobrar NUNCA se bloquea por la caja (el servicio no se corta).
// ──────────────────────────────────────────────
import { CashMovementType, PaymentMethod, Prisma, type CashSession } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { audit } from '../../lib/audit.js';
import { fromCents, toCents } from '../../lib/money.js';
import { localDayKey } from '../../lib/time.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';

function emitChanged(restaurantId: number) {
  ioRestaurant(restaurantId).emit(SocketEvents.CASH_CHANGED, {});
}

const METHODS = [PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.TRANSFER] as const;
type Method = typeof METHODS[number];

export interface CashSummary {
  from: string;
  to: string;
  openingAmount: number;
  /** Cobrado en ventas por medio de pago (sin el vuelto) */
  sales: Record<Method, { count: number; amount: number }>;
  /** Cobros de cuenta corriente por medio de pago (deuda + recargo) */
  accountPayments: Record<Method, { count: number; amount: number }>;
  /** Dejado a cuenta (no entró plata) */
  onAccount: { count: number; amount: number };
  movements: { in: number; out: number; list: Array<{ id: number; type: CashMovementType; amount: number; reason: string; createdAt: string; by: string | null }> };
  /** Pedidos anulados en el período (cantidad) */
  cancelledOrders: number;
  /** Ventas cobradas antes de abrir esta caja (con la caja cerrada) */
  salesBeforeOpening: number;
  totalSales: number;
  /** Total que entró (todos los medios) */
  totalCollected: number;
  expectedCash: number;
}

const emptyByMethod = () => Object.fromEntries(METHODS.map(m => [m, { count: 0, amount: 0 }])) as Record<Method, { count: number; amount: number }>;

/** Arma el resumen de una caja entre `from` (exclusivo) y `to` (inclusive). */
async function buildSummary(
  db: Prisma.TransactionClient,
  session: Pick<CashSession, 'id' | 'restaurantId' | 'periodStart' | 'openedAt' | 'openingAmount'>,
  to: Date,
  firstSession: boolean,
): Promise<CashSummary> {
  const restaurantId = session.restaurantId;
  // La primera caja del local arranca en su apertura; las siguientes, justo después del cierre anterior
  const range = firstSession ? { gte: session.periodStart, lte: to } : { gt: session.periodStart, lte: to };
  const [sales, payments, movements, cancelledOrders] = await Promise.all([
    db.sale.findMany({ where: { restaurantId, closedAt: range }, include: { payments: true } }),
    db.accountPayment.findMany({ where: { restaurantId, paidAt: range } }),
    db.cashMovement.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' }, include: { createdBy: { select: { name: true } } } }),
    db.order.count({ where: { restaurantId, status: 'CANCELLED', closedAt: range } }),
  ]);

  const byMethodCents = Object.fromEntries(METHODS.map(m => [m, 0])) as Record<Method, number>;
  const salesBy = emptyByMethod();
  let onAccountCents = 0;
  let onAccountCount = 0;
  let totalSalesCents = 0;
  let before = 0;
  for (const s of sales) {
    totalSalesCents += toCents(s.total);
    if (s.closedAt < session.openedAt) before++;
    if (s.paymentMethod === PaymentMethod.ACCOUNT) { onAccountCount++; onAccountCents += toCents(s.total); continue; }
    // Cada parte del pago en su medio (las cuentas mixtas o divididas se reparten)
    for (const p of s.payments) {
      const m = p.method as Method;
      if (!METHODS.includes(m)) continue;
      salesBy[m].count++;
      byMethodCents[m] += toCents(p.amount);
    }
  }
  for (const m of METHODS) salesBy[m].amount = fromCents(byMethodCents[m]);

  const payBy = emptyByMethod();
  const payCents = Object.fromEntries(METHODS.map(m => [m, 0])) as Record<Method, number>;
  for (const p of payments) {
    if (p.paymentMethod === PaymentMethod.ACCOUNT) continue;
    const m = p.paymentMethod as Method;
    payBy[m].count++;
    payCents[m] += toCents(p.total);
  }
  for (const m of METHODS) payBy[m].amount = fromCents(payCents[m]);

  let inCents = 0;
  let outCents = 0;
  for (const mv of movements) {
    if (mv.type === CashMovementType.IN) inCents += toCents(mv.amount);
    else outCents += toCents(mv.amount);
  }

  const collectedTotal = METHODS.reduce((s, m) => s + byMethodCents[m] + payCents[m], 0);
  const expected = toCents(session.openingAmount) + byMethodCents.CASH + payCents.CASH + inCents - outCents;
  return {
    from: session.periodStart.toISOString(),
    to: to.toISOString(),
    openingAmount: Number(session.openingAmount),
    sales: salesBy,
    accountPayments: payBy,
    onAccount: { count: onAccountCount, amount: fromCents(onAccountCents) },
    movements: {
      in: fromCents(inCents), out: fromCents(outCents),
      list: movements.map(mv => ({
        id: mv.id, type: mv.type, amount: Number(mv.amount), reason: mv.reason,
        createdAt: mv.createdAt.toISOString(), by: mv.createdBy?.name ?? null,
      })),
    },
    cancelledOrders,
    salesBeforeOpening: before,
    totalSales: fromCents(totalSalesCents),
    totalCollected: fromCents(collectedTotal),
    expectedCash: fromCents(expected),
  };
}

async function isFirstSession(db: Prisma.TransactionClient, restaurantId: number, sessionId: number) {
  return (await db.cashSession.count({ where: { restaurantId, id: { lt: sessionId } } })) === 0;
}

async function openSession(restaurantId: number) {
  return prisma.cashSession.findUnique({ where: { openKey: restaurantId } });
}

function money(value: number, what: string) {
  if (!Number.isFinite(value) || value < 0) throw HttpError.badRequest(`${what} no puede ser negativo`);
  if (value > 100_000_000) throw HttpError.badRequest(`${what} es demasiado grande`);
  return toCents(value);
}

export const cashService = {
  /** Caja abierta con su resumen en vivo, o el estado si está cerrada. */
  async current(restaurantId: number) {
    const s = await openSession(restaurantId);
    const last = await prisma.cashSession.findFirst({ where: { restaurantId, closedAt: { not: null } }, orderBy: { closedAt: 'desc' } });
    if (!s) {
      // Cobros hechos después del último cierre (entrarán en la próxima caja)
      const pending = last
        ? await prisma.sale.aggregate({ where: { restaurantId, closedAt: { gt: last.closedAt! } }, _count: { _all: true }, _sum: { total: true } })
        : null;
      return {
        open: null,
        lastClosedAt: last?.closedAt?.toISOString() ?? null,
        salesSinceLastClose: pending ? { count: pending._count._all, total: Number(pending._sum.total ?? 0) } : null,
      };
    }
    const summary = await buildSummary(prisma, s, new Date(), await isFirstSession(prisma, restaurantId, s.id));
    const openedBy = s.openedById ? await prisma.user.findUnique({ where: { id: s.openedById }, select: { name: true } }) : null;
    return {
      open: { id: s.id, openedAt: s.openedAt.toISOString(), openedBy: openedBy?.name ?? null, openingAmount: Number(s.openingAmount), summary },
      lastClosedAt: last?.closedAt?.toISOString() ?? null,
      salesSinceLastClose: null,
    };
  },

  /** Abre la caja con el monto inicial. Una sola abierta por local. */
  async open(restaurantId: number, openingAmount: number, userId: number | null) {
    const cents = money(openingAmount, 'El monto inicial');
    try {
      const s = await prisma.$transaction(async (tx) => {
        const last = await tx.cashSession.findFirst({ where: { restaurantId, closedAt: { not: null } }, orderBy: { closedAt: 'desc' } });
        const now = new Date();
        const created = await tx.cashSession.create({
          data: {
            restaurantId, openKey: restaurantId, openedAt: now, openedById: userId,
            openingAmount: fromCents(cents), periodStart: last?.closedAt ?? now,
          },
        });
        await audit(tx, { restaurantId, action: 'cash.open', entity: 'CashSession', entityId: created.id, userId: userId ?? undefined, after: { openingAmount: created.openingAmount } });
        return created;
      });
      emitChanged(restaurantId);
      return s;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw HttpError.conflict('La caja ya está abierta');
      throw err;
    }
  },

  /** Ingreso o egreso de efectivo con motivo (pago a un proveedor, cambio que se trajo…). */
  async addMovement(restaurantId: number, input: { type: CashMovementType; amount: number; reason: string; userId: number | null }) {
    const cents = money(input.amount, 'El monto');
    if (cents === 0) throw HttpError.badRequest('El monto tiene que ser mayor a cero');
    const reason = input.reason.trim();
    if (reason.length < 3) throw HttpError.badRequest('Escribí el motivo');
    const s = await openSession(restaurantId);
    if (!s) throw HttpError.conflict('La caja está cerrada: abrila primero');
    const mv = await prisma.$transaction(async (tx) => {
      const created = await tx.cashMovement.create({
        data: { restaurantId, sessionId: s.id, type: input.type, amount: fromCents(cents), reason, createdById: input.userId },
      });
      await audit(tx, {
        restaurantId, action: 'cash.movement', entity: 'CashMovement', entityId: created.id, userId: input.userId ?? undefined,
        after: { type: created.type, amount: created.amount, sessionId: s.id }, reason,
      });
      return created;
    });
    emitChanged(restaurantId);
    return mv;
  },

  /** Cierra la caja con el efectivo contado. Guarda el resumen y la diferencia. */
  async close(restaurantId: number, input: { countedCash: number; notes?: string | null; userId: number | null }) {
    const counted = money(input.countedCash, 'El efectivo contado');
    const s = await openSession(restaurantId);
    if (!s) throw HttpError.conflict('La caja ya está cerrada');
    const closed = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const summary = await buildSummary(tx, s, now, await isFirstSession(tx, restaurantId, s.id));
      const expected = toCents(summary.expectedCash);
      const r = await tx.cashSession.updateMany({
        where: { id: s.id, openKey: restaurantId },
        data: {
          openKey: null, closedAt: now, closedById: input.userId,
          expectedCash: fromCents(expected), countedCash: fromCents(counted), difference: fromCents(counted - expected),
          closeNotes: input.notes?.trim() || null, summary: summary as unknown as Prisma.InputJsonValue,
        },
      });
      if (r.count !== 1) throw HttpError.conflict('Otra persona cerró la caja recién');
      await audit(tx, {
        restaurantId, action: 'cash.close', entity: 'CashSession', entityId: s.id, userId: input.userId ?? undefined,
        after: { expectedCash: fromCents(expected), countedCash: fromCents(counted), difference: fromCents(counted - expected), totalCollected: summary.totalCollected },
        reason: input.notes?.trim() || null,
      });
      return tx.cashSession.findUniqueOrThrow({ where: { id: s.id } });
    });
    emitChanged(restaurantId);
    return closed;
  },

  /** Cajas cerradas (más nuevas primero). */
  async history(restaurantId: number, limit = 30) {
    const rows = await prisma.cashSession.findMany({
      where: { restaurantId, closedAt: { not: null } },
      orderBy: { closedAt: 'desc' },
      take: limit,
      include: { openedBy: { select: { name: true } }, closedBy: { select: { name: true } } },
    });
    return rows.map(r => ({
      id: r.id, openedAt: r.openedAt.toISOString(), closedAt: r.closedAt!.toISOString(),
      openedBy: r.openedBy?.name ?? null, closedBy: r.closedBy?.name ?? null,
      openingAmount: Number(r.openingAmount), expectedCash: Number(r.expectedCash), countedCash: Number(r.countedCash),
      difference: Number(r.difference), closeNotes: r.closeNotes, summary: r.summary as unknown as CashSummary,
    }));
  },
};

/** Día ISO (1 = lunes … 7 = domingo) de hoy en el local. */
function todayIsoWeekday(): number {
  const [y, m, d] = localDayKey(new Date()).split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return dow === 0 ? 7 : dow;
}

function parseDays(raw: string): number[] {
  return [...new Set(raw.split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n >= 1 && n <= 7))].sort();
}

/** Promo de efectivo (tarea 5.2): se sugiere al cobrar en efectivo esos días; la caja decide. */
export const promoService = {
  async get(restaurantId: number) {
    const r = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { cashPromoPct: true, cashPromoDays: true } });
    const days = parseDays(r.cashPromoDays);
    const pct = r.cashPromoPct === null ? null : Number(r.cashPromoPct);
    return { pct, days, today: todayIsoWeekday(), activeToday: !!pct && days.includes(todayIsoWeekday()) };
  },
  async set(restaurantId: number, input: { pct: number | null; days: number[] }) {
    if (input.pct !== null && (!Number.isFinite(input.pct) || input.pct <= 0 || input.pct > 100)) {
      throw HttpError.badRequest('El porcentaje tiene que estar entre 0 y 100');
    }
    const days = parseDays(input.days.join(','));
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { cashPromoPct: input.pct, cashPromoDays: days.join(',') } });
    emitChanged(restaurantId);
    return promoService.get(restaurantId);
  },
};
