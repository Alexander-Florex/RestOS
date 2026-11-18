// ──────────────────────────────────────────────
// printing.service.ts — Comandas y tickets de caja (tarea 1.1)
//
// Los tickets se arman con lo guardado en la base (nunca con datos del navegador)
// y pasan por la cola de impresión (print-jobs.ts): quedan registrados, se ven en
// la pantalla "Comandera" y el agente del local los imprime.
// ──────────────────────────────────────────────
import { SaleChannel, type PrintJob } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { audit } from '../../lib/audit.js';
import { itemNotesForPrint, modifierLines } from '../../lib/modifiers.js';
import { tableLabel } from '../../shared/table-label.js';
import { buildTicket, sampleTicket, type PaperWidth, type PrintPayload, type TicketDoc } from '../../shared/ticket.js';
import { enqueuePrint, socketJob, ticketHeader } from './print-jobs.js';

function jobView(job: PrintJob) {
  return {
    id: job.id,
    kind: job.kind,
    title: job.title,
    status: job.status,
    error: job.error,
    reprintOfId: job.reprintOfId,
    createdAt: job.createdAt,
    printedAt: job.printedAt,
    doc: job.doc as unknown as TicketDoc,
  };
}

export const printingService = {
  /** Comanda de cocina de un pedido de mesa (solo lo que sigue en pie) */
  async printOrder(opts: { restaurantId: number; orderId: number }) {
    const order = await prisma.order.findFirst({
      where: { id: opts.orderId, restaurantId: opts.restaurantId },
      include: { items: { where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } }, table: true, createdBy: { select: { name: true } } },
    });
    if (!order) throw HttpError.notFound('Pedido no encontrado');
    if (order.items.length === 0) throw HttpError.badRequest('El pedido no tiene platos para imprimir');

    const isTakeaway = typeof order.notes === 'string' && order.notes.startsWith('PARA LLEVAR:');
    const job = await enqueuePrint(opts.restaurantId, {
      type: 'kitchen',
      tableNumber: order.table.number,
      orderNumber: order.id,
      isTakeaway,
      takeawayName: isTakeaway ? order.notes!.replace('PARA LLEVAR:', '').trim() : null,
      waiterName: order.createdBy?.name ?? null,
      notes: isTakeaway ? null : order.notes,
      items: order.items.map(i => ({
        name: i.itemName,
        quantity: i.quantity,
        notes: itemNotesForPrint(i.modifiers, i.notes),
        note: i.notes,
        modifiers: modifierLines(i.modifiers),
      })),
    });
    return jobView(job);
  },

  /** Comanda de cocina de un pedido para llevar */
  async printTakeawayKitchen(opts: { restaurantId: number; takeawayId: number }) {
    const order = await prisma.takeawayOrder.findFirst({
      where: { id: opts.takeawayId, restaurantId: opts.restaurantId },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (!order) throw HttpError.notFound('Pedido para llevar no encontrado');
    const job = await enqueuePrint(opts.restaurantId, {
      type: 'kitchen',
      tableNumber: 0,
      orderNumber: order.id,
      isTakeaway: true,
      takeawayName: order.customerName,
      notes: order.notes,
      items: order.items.map(i => ({
        name: i.itemName,
        quantity: i.quantity,
        notes: itemNotesForPrint(i.modifiers, i.notes),
        note: i.notes,
        modifiers: modifierLines(i.modifiers),
      })),
    });
    return jobView(job);
  },

  /** Ticket de caja de una venta: sale de lo guardado, así coincide siempre con la venta */
  async printSale(opts: { restaurantId: number; saleId: number }) {
    const sale = await prisma.sale.findFirst({
      where: { id: opts.saleId, restaurantId: opts.restaurantId },
      include: {
        items: { orderBy: { id: 'asc' } },
        payments: { orderBy: { id: 'asc' } },
        takeawayOrder: { select: { customerName: true } },
        customer: { select: { name: true } },
      },
    });
    if (!sale) throw HttpError.notFound('Venta no encontrada');

    const isTakeaway = sale.channel === SaleChannel.TAKEAWAY;
    const mode = (await prisma.restaurant.findUnique({ where: { id: opts.restaurantId }, select: { tableLabelMode: true } }))?.tableLabelMode;
    const job = await enqueuePrint(opts.restaurantId, {
      type: 'cash',
      saleNumber: sale.id,
      tableNumber: sale.tableNumber ?? 0,
      // La mesa como quedó en la venta (con mesas unidas: "Ventana + Patio")
      ...(sale.tableNumber !== null
        ? { tableName: sale.tableName, tableLabel: tableLabel({ number: sale.tableNumber, name: sale.tableName }, mode) }
        : {}),
      isTakeaway,
      takeawayName: isTakeaway ? (sale.takeawayOrder?.customerName ?? null) : null,
      customerName: isTakeaway ? (sale.takeawayOrder?.customerName ?? null) : (sale.customer?.name ?? null),
      items: sale.items.map(i => ({
        name: i.itemName,
        quantity: i.quantity,
        price: Number(i.price),
        notes: itemNotesForPrint(i.modifiers, null),
        modifiers: modifierLines(i.modifiers),
      })),
      subtotal: sale.subtotal !== null ? Number(sale.subtotal) : undefined,
      discount: Number(sale.discount),
      discountPct: sale.discountPct !== null ? Number(sale.discountPct) : null,
      discountReason: sale.discountReason,
      total: Number(sale.total),
      amountPaid: Number(sale.amount),
      paymentMethod: sale.paymentMethod,
      payments: sale.payments.map(p => ({ method: p.method, amount: Number(p.amount), tendered: p.tendered !== null ? Number(p.tendered) : null })),
      notes: sale.notes,
    });
    return jobView(job);
  },

  /** Ticket de caja de un pedido para llevar: existe solo si ya se cobró */
  async printTakeawayReceipt(opts: { restaurantId: number; takeawayId: number }) {
    const sale = await prisma.sale.findFirst({
      where: { takeawayOrderId: opts.takeawayId, restaurantId: opts.restaurantId },
      select: { id: true },
    });
    if (!sale) throw HttpError.conflict('El pedido todavía no está cobrado');
    return printingService.printSale({ restaurantId: opts.restaurantId, saleId: sale.id });
  },

  // ── Comandera ──

  async listJobs(restaurantId: number, limit = 50) {
    const jobs = await prisma.printJob.findMany({
      where: { restaurantId },
      orderBy: { id: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return jobs.map(jobView);
  },

  /** Volver a mandar un ticket tal cual (queda como trabajo nuevo, vinculado al original) */
  async reprint(restaurantId: number, jobId: number) {
    const job = await prisma.printJob.findFirst({ where: { id: jobId, restaurantId } });
    if (!job) throw HttpError.notFound('Trabajo de impresión no encontrado');
    const again = await enqueuePrint(restaurantId, job.payload as unknown as PrintPayload, { reprintOfId: job.id });
    return jobView(again);
  },

  /** El agente avisa si imprimió o no */
  async markJob(restaurantId: number, jobId: number, ok: boolean, error?: string | null) {
    const res = await prisma.printJob.updateMany({
      where: { id: jobId, restaurantId },
      data: ok
        ? { status: 'PRINTED', printedAt: new Date(), error: null }
        : { status: 'FAILED', error: (error || 'La impresora no respondió').slice(0, 500) },
    });
    if (res.count !== 1) throw HttpError.notFound('Trabajo de impresión no encontrado');
    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    return jobView(job);
  },

  /** Ticket de ejemplo con el nombre y el ancho de papel del local (no se guarda ni se imprime) */
  async sample(restaurantId: number, kind: 'kitchen' | 'cash', paperWidth?: PaperWidth) {
    const { header } = await ticketHeader(restaurantId);
    return buildTicket(sampleTicket(kind), paperWidth ? { ...header, paperWidth } : header);
  },

  /** Imprimir el ejemplo (para probar la comandera) */
  async printSample(restaurantId: number, kind: 'kitchen' | 'cash') {
    return jobView(await enqueuePrint(restaurantId, sampleTicket(kind)));
  },

  async getSettings(restaurantId: number) {
    const r = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { printPaperWidth: true } });
    return { paperWidth: (r?.printPaperWidth === 58 ? 58 : 80) as PaperWidth };
  },

  async setSettings(restaurantId: number, paperWidth: PaperWidth, userId: number | null) {
    await prisma.$transaction(async (tx) => {
      const before = await tx.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { printPaperWidth: true } });
      await tx.restaurant.update({ where: { id: restaurantId }, data: { printPaperWidth: paperWidth } });
      await audit(tx, {
        restaurantId, action: 'printing.settings', entity: 'Restaurant', entityId: restaurantId,
        userId: userId ?? undefined, before: { paperWidth: before.printPaperWidth }, after: { paperWidth },
      });
    });
    return { paperWidth };
  },
};

export { socketJob };
