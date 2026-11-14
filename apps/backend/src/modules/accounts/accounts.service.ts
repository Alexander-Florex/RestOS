// ──────────────────────────────────────────────
// accounts.service.ts — Cuenta corriente (tarea 5.9)
//
// La Municipalidad o la cooperativa comen, firman la comanda y pagan después contra
// factura semanal. La mesa se cierra "a cuenta" (venta con paymentMethod ACCOUNT, sin
// plata); cuando pagan se registra un cobro que salda esas ventas, con el recargo que
// decide caja al cobrar (casi siempre 20 % o más) como importe aparte.
// ──────────────────────────────────────────────
import { PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { audit } from '../../lib/audit.js';
import { fromCents, toCents } from '../../lib/money.js';
import { addDays, localDayKey, weekStartOf, type DayKey } from '../../lib/time.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';
import { tableLabel } from '../../shared/table-label.js';

function emitChanged(restaurantId: number) {
  ioRestaurant(restaurantId).emit(SocketEvents.ACCOUNTS_CHANGED, {});
}

function clean(s: string | null | undefined): string | null {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v ? v : null;
}

async function getCustomer(restaurantId: number, id: number) {
  const c = await prisma.accountCustomer.findFirst({ where: { id, restaurantId } });
  if (!c) throw HttpError.notFound('Cliente de cuenta corriente no encontrado');
  return c;
}

function duplicate(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw HttpError.conflict('Ya hay un cliente de cuenta corriente con ese nombre');
  }
  throw err;
}

/** Ventas a cuenta todavía impagas. */
const unpaidWhere = (restaurantId: number, customerId?: number): Prisma.SaleWhereInput => ({
  restaurantId, paymentMethod: PaymentMethod.ACCOUNT, accountPaymentId: null,
  ...(customerId !== undefined ? { customerId } : { customerId: { not: null } }),
});

export interface StatementSale {
  id: number; closedAt: string; day: DayKey; table: string | null; total: number; notes: string | null;
}

export const accountsService = {
  // ── Clientes ──
  async listCustomers(restaurantId: number) {
    const [customers, debts] = await Promise.all([
      prisma.accountCustomer.findMany({ where: { restaurantId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
      prisma.sale.groupBy({
        by: ['customerId'], where: unpaidWhere(restaurantId),
        _sum: { total: true }, _count: { _all: true }, _min: { closedAt: true },
      }),
    ]);
    const byCustomer = new Map(debts.map(d => [d.customerId, d]));
    return customers.map(c => {
      const d = byCustomer.get(c.id);
      return {
        ...c,
        balance: d?._sum.total ? Number(d._sum.total) : 0,
        unpaidCount: d?._count._all ?? 0,
        oldestUnpaid: d?._min.closedAt?.toISOString() ?? null,
      };
    });
  },

  async createCustomer(restaurantId: number, data: { name: string; cuit?: string | null; contact?: string | null }) {
    const name = clean(data.name);
    if (!name) throw HttpError.badRequest('Poné el nombre del cliente');
    const c = await prisma.accountCustomer.create({
      data: { restaurantId, name, cuit: clean(data.cuit), contact: clean(data.contact) },
    }).catch(duplicate);
    emitChanged(restaurantId);
    return c;
  },

  async updateCustomer(restaurantId: number, id: number, data: { name?: string; cuit?: string | null; contact?: string | null; active?: boolean }) {
    await getCustomer(restaurantId, id);
    const name = data.name !== undefined ? clean(data.name) : undefined;
    if (name === null) throw HttpError.badRequest('Poné el nombre del cliente');
    const c = await prisma.accountCustomer.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(data.cuit !== undefined ? { cuit: clean(data.cuit) } : {}),
        ...(data.contact !== undefined ? { contact: clean(data.contact) } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    }).catch(duplicate);
    emitChanged(restaurantId);
    return c;
  },

  /** Solo se borra un cliente sin comidas a cuenta; si tiene, se desactiva. */
  async removeCustomer(restaurantId: number, id: number) {
    await getCustomer(restaurantId, id);
    const sales = await prisma.sale.count({ where: { restaurantId, customerId: id } });
    if (sales > 0) throw HttpError.conflict('Tiene comidas a cuenta registradas: desactivalo en lugar de borrarlo.');
    await prisma.accountCustomer.delete({ where: { id } });
    emitChanged(restaurantId);
  },

  /** Estado de cuenta: lo que debe, agrupado por semana (lunes a domingo), y los cobros. */
  async statement(restaurantId: number, customerId: number) {
    const customer = await getCustomer(restaurantId, customerId);
    const [mode, unpaid, payments] = await Promise.all([
      prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { tableLabelMode: true } }),
      prisma.sale.findMany({ where: unpaidWhere(restaurantId, customerId), orderBy: { closedAt: 'asc' } }),
      prisma.accountPayment.findMany({
        where: { restaurantId, customerId },
        orderBy: { paidAt: 'desc' },
        take: 50,
        include: { registeredBy: { select: { name: true } }, _count: { select: { sales: true } } },
      }),
    ]);

    const weeks = new Map<DayKey, { weekStart: DayKey; weekEnd: DayKey; totalCents: number; sales: StatementSale[] }>();
    for (const s of unpaid) {
      const day = localDayKey(s.closedAt);
      const ws = weekStartOf(day);
      const w = weeks.get(ws) ?? { weekStart: ws, weekEnd: addDays(ws, 6), totalCents: 0, sales: [] };
      w.totalCents += toCents(s.total);
      w.sales.push({
        id: s.id, closedAt: s.closedAt.toISOString(), day, total: Number(s.total), notes: s.notes,
        table: s.tableNumber === null ? null : tableLabel({ number: s.tableNumber, name: s.tableName }, mode?.tableLabelMode),
      });
      weeks.set(ws, w);
    }
    const weekList = [...weeks.values()]
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
      .map(({ totalCents, ...w }) => ({ ...w, total: totalCents / 100 }));

    return {
      customer,
      balance: weekList.reduce((s, w) => s + toCents(w.total), 0) / 100,
      weeks: weekList,
      payments: payments.map(p => ({
        id: p.id, paidAt: p.paidAt.toISOString(), debt: Number(p.debt), surchargePct: Number(p.surchargePct),
        surcharge: Number(p.surcharge), total: Number(p.total), paymentMethod: p.paymentMethod, notes: p.notes,
        registeredByName: p.registeredBy?.name ?? null, salesCount: p._count.sales,
      })),
    };
  },

  /**
   * Registra que el cliente pagó estas comidas. El recargo (% sobre la deuda) va aparte.
   * Cada venta solo puede saldarse una vez: el updateMany con accountPaymentId = null es
   * la garantía (dos cobros simultáneos de la misma comida: uno da 409 y se revierte).
   */
  async registerPayment(restaurantId: number, input: {
    customerId: number; saleIds: number[]; surchargePct: number; paymentMethod: PaymentMethod;
    notes?: string | null; userId: number | null;
  }) {
    const saleIds = [...new Set(input.saleIds)];
    if (saleIds.length === 0) throw HttpError.badRequest('Elegí qué comidas paga');
    if (input.paymentMethod === PaymentMethod.ACCOUNT) throw HttpError.badRequest('Elegí cómo pagó (efectivo, tarjeta o transferencia)');
    if (!Number.isFinite(input.surchargePct) || input.surchargePct < 0 || input.surchargePct > 300) {
      throw HttpError.badRequest('El recargo tiene que estar entre 0 y 300 %');
    }
    const customer = await getCustomer(restaurantId, input.customerId);

    const payment = await prisma.$transaction(async (tx) => {
      const sales = await tx.sale.findMany({ where: { id: { in: saleIds }, ...unpaidWhere(restaurantId, customer.id) } });
      if (sales.length !== saleIds.length) {
        throw HttpError.conflict('Alguna de las comidas ya se cobró, no es de este cliente o no es a cuenta. Recargá el estado de cuenta.');
      }
      const debtCents = sales.reduce((s, x) => s + toCents(x.total), 0);
      const pctHundredths = Math.round(input.surchargePct * 100); // 12,5 % → 1250
      const surchargeCents = Math.round((debtCents * pctHundredths) / 10_000);
      const p = await tx.accountPayment.create({
        data: {
          restaurantId, customerId: customer.id,
          debt: fromCents(debtCents), surchargePct: new Prisma.Decimal(pctHundredths).div(100),
          surcharge: fromCents(surchargeCents), total: fromCents(debtCents + surchargeCents),
          paymentMethod: input.paymentMethod, notes: clean(input.notes), paidAt: new Date(),
          registeredById: input.userId,
        },
      });
      const linked = await tx.sale.updateMany({
        where: { id: { in: saleIds }, ...unpaidWhere(restaurantId, customer.id) },
        data: { accountPaymentId: p.id },
      });
      if (linked.count !== saleIds.length) {
        throw HttpError.conflict('Otra persona registró el cobro de alguna de estas comidas recién. Recargá el estado de cuenta.');
      }
      await audit(tx, {
        restaurantId, action: 'account.payment', entity: 'AccountPayment', entityId: p.id, userId: input.userId ?? undefined,
        after: {
          customer: customer.name, saleIds, debt: p.debt, surchargePct: p.surchargePct,
          surcharge: p.surcharge, total: p.total, paymentMethod: p.paymentMethod, notes: p.notes,
        },
      });
      return p;
    });
    emitChanged(restaurantId);
    return payment;
  },

  /** Anula un cobro cargado por error: sus comidas vuelven a deberse. */
  async cancelPayment(restaurantId: number, paymentId: number, reason: string) {
    const why = clean(reason);
    if (!why || why.length < 3) throw HttpError.badRequest('Escribí el motivo');
    const p = await prisma.accountPayment.findFirst({ where: { id: paymentId, restaurantId }, include: { customer: true, sales: { select: { id: true } } } });
    if (!p) throw HttpError.notFound('Cobro no encontrado');
    await prisma.$transaction(async (tx) => {
      await tx.sale.updateMany({ where: { accountPaymentId: p.id, restaurantId }, data: { accountPaymentId: null } });
      await tx.accountPayment.delete({ where: { id: p.id } });
      await audit(tx, {
        restaurantId, action: 'account.payment.cancel', entity: 'AccountPayment', entityId: p.id,
        before: {
          customer: p.customer.name, saleIds: p.sales.map(s => s.id), debt: p.debt, surchargePct: p.surchargePct,
          surcharge: p.surcharge, total: p.total, paymentMethod: p.paymentMethod, paidAt: p.paidAt,
        },
        reason: why,
      });
    });
    emitChanged(restaurantId);
  },

  /** Cobros de cuenta corriente en un rango (para reportes y caja del día). */
  async collections(restaurantId: number, from: Date, to: Date) {
    const agg = await prisma.accountPayment.aggregate({
      where: { restaurantId, paidAt: { gte: from, lte: to } },
      _sum: { debt: true, surcharge: true, total: true }, _count: { _all: true },
    });
    return {
      count: agg._count._all,
      debt: Number(agg._sum.debt ?? 0),
      surcharge: Number(agg._sum.surcharge ?? 0),
      total: Number(agg._sum.total ?? 0),
    };
  },
};
