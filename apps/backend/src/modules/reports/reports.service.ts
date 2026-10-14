// ──────────────────────────────────────────────
// reports.service.ts — Reportes agregados de ventas
// ──────────────────────────────────────────────
import { PaymentMethod } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { collectedCents, fromCents } from '../../lib/money.js';

export interface ReportRange {
  from: Date;
  to: Date;
}

export interface SalesReport {
  range: { from: string; to: string };
  totals: {
    totalSold: number;
    totalCollected: number;
    salesCount: number;
    averageTicket: number;
  };
  byPaymentMethod: Array<{
    method: PaymentMethod;
    count: number;
    amount: number;
    percentage: number;
  }>;
  byDay: Array<{
    date: string; // YYYY-MM-DD
    total: number;
    count: number;
  }>;
  byTable: Array<{
    tableNumber: number;
    count: number;
    total: number;
  }>;
}

export interface TopItem {
  menuItemId: number | null;
  itemName: string;
  category: string;
  quantity: number;
  revenue: number;
}

export interface DailyTicket {
  id: number;
  tableNumber: number;
  closedAt: string;
  total: number;
  amount: number;
  paymentMethod: PaymentMethod;
  registeredByName: string | null;
  items: Array<{ itemName: string; quantity: number; subtotal: number }>;
}

export const reportsService = {
  async salesReport(restaurantId: number, { from, to }: ReportRange): Promise<SalesReport> {
    const sales = await prisma.sale.findMany({
      where: { restaurantId, closedAt: { gte: from, lte: to } },
      orderBy: { closedAt: 'asc' },
    });

    const totalSold = sales.reduce((sum, s) => sum + Number(s.total), 0);
    // amount incluye el vuelto en efectivo: lo cobrado de cada venta es min(amount, total)
    const totalCollected = fromCents(sales.reduce((sum, s) => sum + collectedCents(s), 0));
    const salesCount = sales.length;
    const averageTicket = salesCount > 0 ? totalSold / salesCount : 0;

    // Breakdown por método de pago
    const methodMap = new Map<PaymentMethod, { count: number; amount: number }>();
    for (const m of Object.values(PaymentMethod)) {
      methodMap.set(m, { count: 0, amount: 0 });
    }
    for (const s of sales) {
      const entry = methodMap.get(s.paymentMethod)!;
      entry.count++;
      entry.amount += Number(s.total);
    }
    const byPaymentMethod = Array.from(methodMap.entries()).map(([method, data]) => ({
      method,
      count: data.count,
      amount: data.amount,
      percentage: totalSold > 0 ? (data.amount / totalSold) * 100 : 0,
    }));

    // Breakdown por día (YYYY-MM-DD)
    const dayMap = new Map<string, { total: number; count: number }>();
    for (const s of sales) {
      const date = s.closedAt.toISOString().slice(0, 10);
      const entry = dayMap.get(date) ?? { total: 0, count: 0 };
      entry.total += Number(s.total);
      entry.count++;
      dayMap.set(date, entry);
    }
    const byDay = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, total: data.total, count: data.count }));

    // Breakdown por mesa
    const tableMap = new Map<number, { total: number; count: number }>();
    for (const s of sales) {
      const entry = tableMap.get(s.tableNumber) ?? { total: 0, count: 0 };
      entry.total += Number(s.total);
      entry.count++;
      tableMap.set(s.tableNumber, entry);
    }
    const byTable = Array.from(tableMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([tableNumber, data]) => ({ tableNumber, total: data.total, count: data.count }));

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: { totalSold, totalCollected, salesCount, averageTicket },
      byPaymentMethod,
      byDay,
      byTable,
    };
  },

  /** Listado de tickets (cuentas cerradas) de un día, ordenado por hora. */
  async dailyTickets(restaurantId: number, { from, to }: ReportRange): Promise<DailyTicket[]> {
    const sales = await prisma.sale.findMany({
      where: { restaurantId, closedAt: { gte: from, lte: to } },
      orderBy: { closedAt: 'asc' },
      include: { items: true, registeredBy: { select: { name: true } } },
    });

    return sales.map(s => ({
      id: s.id,
      tableNumber: s.tableNumber,
      closedAt: s.closedAt.toISOString(),
      total: Number(s.total),
      amount: Number(s.amount),
      paymentMethod: s.paymentMethod,
      registeredByName: s.registeredBy?.name ?? null,
      items: s.items.map(i => ({
        itemName: i.itemName,
        quantity: i.quantity,
        subtotal: Number(i.subtotal),
      })),
    }));
  },

  /** Ranking de items más vendidos en el rango. */
  async topItems(restaurantId: number, { from, to }: ReportRange, limit = 10): Promise<TopItem[]> {
    // groupBy de Prisma para sumar cantidades y subtotales por item
    const groups = await prisma.saleItem.groupBy({
      by: ['menuItemId', 'itemName', 'category'],
      where: {
        sale: { restaurantId, closedAt: { gte: from, lte: to } },
      },
      _sum: {
        quantity: true,
        subtotal: true,
      },
      orderBy: {
        _sum: { quantity: 'desc' },
      },
      take: limit,
    });

    return groups.map(g => ({
      menuItemId: g.menuItemId,
      itemName: g.itemName,
      category: g.category,
      quantity: g._sum.quantity ?? 0,
      revenue: Number(g._sum.subtotal ?? 0),
    }));
  },

  /** Genera CSV con las ventas del rango. */
  async salesCsv(restaurantId: number, { from, to }: ReportRange): Promise<string> {
    const sales = await prisma.sale.findMany({
      where: { restaurantId, closedAt: { gte: from, lte: to } },
      orderBy: { closedAt: 'asc' },
      include: { items: true },
    });

    const headers = [
      'ID', 'Fecha', 'Mesa', 'Metodo de pago', 'Total', 'Cobrado',
      'Cantidad items', 'Items', 'Notas',
    ];
    const rows = sales.map(s => {
      const itemsText = s.items.map(i => `${i.quantity}x ${i.itemName}`).join(' | ');
      const itemsCount = s.items.reduce((acc, i) => acc + i.quantity, 0);
      return [
        s.id,
        s.closedAt.toISOString(),
        s.tableNumber,
        s.paymentMethod,
        Number(s.total).toFixed(2),
        Number(s.amount).toFixed(2),
        itemsCount,
        itemsText,
        (s.notes ?? '').replace(/"/g, '""'),
      ];
    });

    const escape = (v: unknown) => {
      const str = String(v ?? '');
      if (/[",\n;]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
      return str;
    };

    return [headers, ...rows]
      .map(row => row.map(escape).join(','))
      .join('\n');
  },
};
