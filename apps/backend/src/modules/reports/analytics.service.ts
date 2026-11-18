// ──────────────────────────────────────────────
// analytics.service.ts — Reportes de la fase 4
//
// 4.1 Consumo real contra teórico (por insumo y sector).
// 4.2 Rentabilidad por plato y análisis de menú (estrellas, caballos, enigmas, perros).
// 4.3 Cierre del día (medios de pago, canales, ticket promedio, anulaciones, pérdidas).
// 4.4 Panel del dueño (lo importante del día en una pantalla de celular).
// Montos en centavos para sumar; los precios de la carta incluyen IVA (se descuenta para el margen).
// ──────────────────────────────────────────────
import { PaymentMethod, SaleChannel, StockMovementType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { toCents } from '../../lib/money.js';
import { addDays, localDayKey, localDaysRange, type DayKey } from '../../lib/time.js';
import { recipesService } from '../recipes/recipes.service.js';
import { explode, loadRecipes, recipeByMenuItem, type Explosion } from '../../lib/recipe-explode.js';
import { stockAutoService } from '../stock/stock-auto.service.js';
import { cashService } from '../cash/cash.service.js';
import { convertUnits } from '../../shared/units.js';

const VAT = 1.21;
const c2 = (cents: number) => Math.round(cents) / 100;

export type MenuClass = 'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG';

export const analyticsService = {
  /**
   * 4.2 Rentabilidad por plato. Ingreso = lo cobrado por el plato (con el descuento de su
   * venta repartido en proporción), sin IVA. Costo = costo actual por porción de la receta.
   * Clasificación (ingeniería de menú): popular si vende ≥ 70 % del promedio; rentable si
   * su ganancia por plato ≥ la ganancia promedio ponderada.
   */
  async profitability(restaurantId: number, from: Date, to: Date) {
    const [sales, costs] = await Promise.all([
      prisma.sale.findMany({ where: { restaurantId, closedAt: { gte: from, lte: to } }, include: { items: true } }),
      recipesService.menuCosts(restaurantId),
    ]);
    const costBy = new Map(costs.map(c => [c.menuItemId, c]));
    const dishes = new Map<string, { menuItemId: number | null; name: string; category: string; qty: number; revenueCents: number }>();
    for (const s of sales) {
      const sub = s.subtotal !== null ? toCents(s.subtotal) : toCents(s.total);
      const factor = sub > 0 ? toCents(s.total) / sub : 1; // descuento de la venta, repartido
      for (const it of s.items) {
        const key = it.menuItemId !== null ? `m${it.menuItemId}` : `n${it.itemName}`;
        const d = dishes.get(key) ?? { menuItemId: it.menuItemId, name: it.itemName, category: it.category, qty: 0, revenueCents: 0 };
        d.qty += it.quantity;
        d.revenueCents += toCents(it.subtotal) * factor;
        dishes.set(key, d);
      }
    }
    const rows = [...dishes.values()].map(d => {
      const cost = d.menuItemId !== null ? costBy.get(d.menuItemId) : undefined;
      const netCents = d.revenueCents / VAT;
      const costCents = cost ? Math.round(cost.costPerServing * 100) * d.qty : null;
      const profitCents = costCents !== null ? netCents - costCents : null;
      return {
        menuItemId: d.menuItemId, name: d.name, category: d.category, quantity: d.qty,
        revenue: c2(d.revenueCents), revenueNet: c2(netCents),
        cost: costCents !== null ? c2(costCents) : null,
        profit: profitCents !== null ? c2(profitCents) : null,
        marginPct: profitCents !== null && netCents > 0 ? Math.round((profitCents / netCents) * 1000) / 10 : null,
        profitPerDish: profitCents !== null && d.qty > 0 ? c2(profitCents / d.qty) : null,
        hasRecipe: !!cost, costComplete: cost?.complete ?? false,
        class: null as MenuClass | null,
      };
    });
    // Ingeniería de menú (solo platos con receta)
    const withCost = rows.filter(r => r.profit !== null && r.quantity > 0);
    const totalQty = withCost.reduce((s, r) => s + r.quantity, 0);
    const totalProfit = withCost.reduce((s, r) => s + r.profit!, 0);
    const popularityLine = withCost.length ? (totalQty / withCost.length) * 0.7 : 0;
    const avgProfitPerDish = totalQty ? totalProfit / totalQty : 0;
    for (const r of withCost) {
      const popular = r.quantity >= popularityLine;
      const profitable = r.profitPerDish! >= avgProfitPerDish;
      r.class = popular && profitable ? 'STAR' : popular ? 'PLOWHORSE' : profitable ? 'PUZZLE' : 'DOG';
    }
    rows.sort((a, b) => (b.profit ?? -Infinity) - (a.profit ?? -Infinity) || b.revenue - a.revenue);
    return {
      dishes: rows,
      totals: {
        revenue: c2(rows.reduce((s, r) => s + toCents(r.revenue), 0)),
        profit: Math.round(totalProfit * 100) / 100,
        popularityLine: Math.round(popularityLine * 10) / 10,
        avgProfitPerDish: Math.round(avgProfitPerDish * 100) / 100,
        withoutRecipe: rows.filter(r => !r.hasRecipe).length,
      },
    };
  },

  /**
   * 4.1 Consumo real contra teórico por insumo.
   * Teórico = lo que debieron usar las ventas según las recetas + lo usado en producción.
   * Real = stock al empezar + lo que entró (compras y producción) − stock al terminar.
   * La diferencia (real − teórico) son mermas no registradas, errores de receta o faltantes.
   * Sirve de verdad entre dos conteos (el stock de inicio y de fin es el contado).
   */
  async theoreticalVsReal(restaurantId: number, from: Date, to: Date) {
    const [recipes, items, sales, movements] = await Promise.all([
      loadRecipes(prisma as never, restaurantId),
      prisma.inventoryItem.findMany({ where: { restaurantId }, include: { storageArea: { select: { name: true } } } }),
      prisma.saleItem.findMany({ where: { sale: { restaurantId, closedAt: { gte: from, lte: to } } }, select: { menuItemId: true, quantity: true } }),
      prisma.stockMovement.findMany({ where: { restaurantId, createdAt: { lte: to } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    ]);
    // Teórico por ventas (con elaborados con stock: se cuenta el elaborado, no sus ingredientes)
    const byMenu = recipeByMenuItem(recipes);
    const theo: Explosion = { needs: new Map(), warnings: [] };
    for (const s of sales) {
      const r = s.menuItemId !== null ? byMenu.get(s.menuItemId) : undefined;
      if (!r) continue;
      if (r.stockItem) {
        try { theo.needs.set(r.stockItem.id, (theo.needs.get(r.stockItem.id) ?? 0) + convertUnits(s.quantity, 'un', r.stockItem.unit)); continue; }
        catch { /* se desarma */ }
      }
      explode(recipes, r.id, s.quantity / (r.yield || 1), theo);
    }
    const start = new Map<number, number>();
    const end = new Map<number, number>();
    const inflow = new Map<number, number>();
    const prodUse = new Map<number, number>();
    for (const m of movements) {
      if (m.createdAt < from) { start.set(m.inventoryItemId, m.balanceAfter); continue; }
      end.set(m.inventoryItemId, m.balanceAfter);
      if (m.type === StockMovementType.PURCHASE || (m.type === StockMovementType.PRODUCTION && m.quantity > 0)) {
        inflow.set(m.inventoryItemId, (inflow.get(m.inventoryItemId) ?? 0) + m.quantity);
      }
      if (m.type === StockMovementType.PRODUCTION && m.quantity < 0) {
        prodUse.set(m.inventoryItemId, (prodUse.get(m.inventoryItemId) ?? 0) - m.quantity);
      }
    }
    const rows = items.map(i => {
      const s = start.get(i.id) ?? 0;
      const e = end.get(i.id) ?? s;
      const real = s + (inflow.get(i.id) ?? 0) - e;
      const theoretical = (theo.needs.get(i.id) ?? 0) + (prodUse.get(i.id) ?? 0);
      const diff = real - theoretical;
      const unitCost = Number(i.costPerUnit);
      return {
        id: i.id, name: i.name, unit: i.unit, area: i.storageArea?.name ?? 'Sin sector',
        real: Math.round(real * 1000) / 1000, theoretical: Math.round(theoretical * 1000) / 1000,
        difference: Math.round(diff * 1000) / 1000, differenceValue: Math.round(diff * unitCost * 100) / 100,
      };
    }).filter(r => r.real !== 0 || r.theoretical !== 0);
    const byArea = new Map<string, number>();
    for (const r of rows) byArea.set(r.area, Math.round(((byArea.get(r.area) ?? 0) + r.differenceValue) * 100) / 100);
    rows.sort((a, b) => Math.abs(b.differenceValue) - Math.abs(a.differenceValue));
    return {
      items: rows,
      byArea: [...byArea.entries()].map(([area, value]) => ({ area, value })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
      totalDifferenceValue: Math.round(rows.reduce((s, r) => s + r.differenceValue, 0) * 100) / 100,
      warnings: [...new Set(theo.warnings)].slice(0, 20),
    };
  },

  /** 4.3 Cierre del día (hora del local). */
  async dailyClose(restaurantId: number, day: DayKey) {
    const { from, to } = localDaysRange(day);
    const [sales, cancelled, changes, payments] = await Promise.all([
      prisma.sale.findMany({ where: { restaurantId, closedAt: { gte: from, lte: to } }, include: { payments: true } }),
      prisma.order.findMany({ where: { restaurantId, status: 'CANCELLED', closedAt: { gte: from, lte: to } }, include: { items: true } }),
      prisma.orderItemChange.findMany({ where: { restaurantId, status: 'APPLIED', resolvedAt: { gte: from, lte: to } } }),
      prisma.accountPayment.findMany({ where: { restaurantId, paidAt: { gte: from, lte: to } } }),
    ]);
    const methods = { CASH: 0, CARD: 0, TRANSFER: 0 } as Record<'CASH' | 'CARD' | 'TRANSFER', number>;
    const channel = { DINE_IN: { count: 0, cents: 0 }, TAKEAWAY: { count: 0, cents: 0 } };
    let soldCents = 0, discountCents = 0, onAccountCents = 0, onAccountCount = 0, discounted = 0;
    for (const s of sales) {
      soldCents += toCents(s.total);
      discountCents += toCents(s.discount);
      if (toCents(s.discount) > 0) discounted++;
      channel[s.channel === SaleChannel.TAKEAWAY ? 'TAKEAWAY' : 'DINE_IN'].count++;
      channel[s.channel === SaleChannel.TAKEAWAY ? 'TAKEAWAY' : 'DINE_IN'].cents += toCents(s.total);
      if (s.paymentMethod === PaymentMethod.ACCOUNT) { onAccountCents += toCents(s.total); onAccountCount++; continue; }
      for (const p of s.payments) if (p.method in methods) methods[p.method as keyof typeof methods] += toCents(p.amount);
    }
    const accountCents = payments.reduce((n, p) => n + toCents(p.total), 0);
    for (const p of payments) if (p.paymentMethod in methods) methods[p.paymentMethod as keyof typeof methods] += toCents(p.total);
    const cancelledCents = cancelled.reduce((n, o) => n + o.items.reduce((m, i) => m + toCents(i.price) * i.quantity, 0), 0);
    const lossCents = changes.filter(c => c.wasPrepared).reduce((n, c) => {
      const price = Number((c.itemSnapshot as { price?: string } | null)?.price ?? 0);
      return n + Math.round(price * 100) * c.quantity;
    }, 0);
    const collectedCents = methods.CASH + methods.CARD + methods.TRANSFER;
    return {
      day,
      salesCount: sales.length,
      sold: c2(soldCents),
      collected: c2(collectedCents),
      averageTicket: sales.length ? c2(soldCents / sales.length) : 0,
      byMethod: { CASH: c2(methods.CASH), CARD: c2(methods.CARD), TRANSFER: c2(methods.TRANSFER) },
      byChannel: { DINE_IN: { count: channel.DINE_IN.count, total: c2(channel.DINE_IN.cents) }, TAKEAWAY: { count: channel.TAKEAWAY.count, total: c2(channel.TAKEAWAY.cents) } },
      discounts: { count: discounted, total: c2(discountCents) },
      onAccount: { count: onAccountCount, total: c2(onAccountCents) },
      accountCollections: { count: payments.length, total: c2(accountCents) },
      cancelledOrders: { count: cancelled.length, total: c2(cancelledCents) },
      changes: { count: changes.length, lost: c2(lossCents) },
    };
  },

  async dailyCloseCsv(restaurantId: number, day: DayKey) {
    const d = await analyticsService.dailyClose(restaurantId, day);
    const money = (n: number) => n.toFixed(2).replace('.', ',');
    const rows: Array<[string, string]> = [
      ['Dia', d.day],
      ['Ventas (cantidad)', String(d.salesCount)],
      ['Vendido', money(d.sold)],
      ['Cobrado', money(d.collected)],
      ['Ticket promedio', money(d.averageTicket)],
      ['Efectivo', money(d.byMethod.CASH)],
      ['Tarjeta', money(d.byMethod.CARD)],
      ['Transferencia', money(d.byMethod.TRANSFER)],
      ['Salon', `${d.byChannel.DINE_IN.count} / ${money(d.byChannel.DINE_IN.total)}`],
      ['Para llevar', `${d.byChannel.TAKEAWAY.count} / ${money(d.byChannel.TAKEAWAY.total)}`],
      ['Descuentos', `${d.discounts.count} / ${money(d.discounts.total)}`],
      ['A cuenta (sin cobrar)', `${d.onAccount.count} / ${money(d.onAccount.total)}`],
      ['Cobros de cuenta corriente', `${d.accountCollections.count} / ${money(d.accountCollections.total)}`],
      ['Pedidos anulados', `${d.cancelledOrders.count} / ${money(d.cancelledOrders.total)}`],
      ['Cambios de platos (perdida)', `${d.changes.count} / ${money(d.changes.lost)}`],
    ];
    return '﻿' + ['Concepto;Valor', ...rows.map(([k, v]) => `${k};${v}`)].join('\r\n');
  },

  /** 4.4 Panel del dueño: lo importante de hoy. */
  async owner(restaurantId: number) {
    const today = localDayKey(new Date());
    const lastWeek = addDays(today, -7);
    const [close, prev, shopping, costs, cash, debt, lastCount] = await Promise.all([
      analyticsService.dailyClose(restaurantId, today),
      analyticsService.dailyClose(restaurantId, lastWeek),
      stockAutoService.shoppingList(restaurantId),
      recipesService.menuCosts(restaurantId),
      cashService.current(restaurantId),
      prisma.sale.aggregate({ where: { restaurantId, paymentMethod: PaymentMethod.ACCOUNT, accountPaymentId: null }, _sum: { total: true } }),
      prisma.stockCount.findFirst({ where: { restaurantId, status: 'CLOSED' }, orderBy: { closedAt: 'desc' }, include: { lines: true } }),
    ]);
    const menu = await prisma.menuItem.findMany({ where: { restaurantId, id: { in: costs.filter(c => c.belowTarget).map(c => c.menuItemId) } }, select: { id: true, name: true } });
    const names = new Map(menu.map(m => [m.id, m.name]));
    const lowStock = shopping.flatMap(g => g.items as Array<{ name: string; quantity: number; minStock: number; unit: string }>);
    const countDiff = lastCount
      ? Math.round(lastCount.lines.reduce((s, l) => s + (l.difference ?? 0) * Number(l.unitCost ?? 0), 0) * 100) / 100
      : null;
    return {
      today: close,
      sameDayLastWeek: { sold: prev.sold, salesCount: prev.salesCount },
      cash: cash.open ? { open: true, expectedCash: cash.open.summary.expectedCash, totalCollected: cash.open.summary.totalCollected } : { open: false },
      lowStock: { count: lowStock.length, items: lowStock.slice(0, 8) },
      lowMargin: costs.filter(c => c.belowTarget).map(c => ({
        name: names.get(c.menuItemId) ?? c.recipeName, actualMargin: c.actualMargin, target: c.margin, suggestedPrice: c.suggestedPrice,
      })).slice(0, 8),
      receivables: Number(debt._sum.total ?? 0),
      lastCount: lastCount ? { area: lastCount.areaName, closedAt: lastCount.closedAt?.toISOString() ?? null, differenceValue: countDiff } : null,
    };
  },
};
