// ──────────────────────────────────────────────
// printing.service.ts — Comandas y tickets de caja (tarea 1.1)
//
// Los tickets se arman con lo guardado en la base (nunca con datos del navegador)
// y pasan por la cola de impresión (print-jobs.ts): quedan registrados, se ven en
// la pantalla "Comandera" y el agente del local los imprime.
// ──────────────────────────────────────────────
import { SaleChannel } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { audit } from '../../lib/audit.js';
import { itemNotesForPrint, modifierLines } from '../../lib/modifiers.js';
import { kitchenFilter } from '../../lib/kitchen-routing.js';
import { tableLabel } from '../../shared/table-label.js';
import { buildTicket, sampleTicket, type PaperWidth, type PrintPayload, type TicketDoc } from '../../shared/ticket.js';
import { env } from '../../config/env.js';
import { listWindowsPrinters } from '../../lib/printers/windows.js';
import { emitJobUpdated, enqueuePrint, jobView, socketJob, ticketHeader } from './print-jobs.js';
import { kickPrinter, printerState } from './printer-worker.js';

type SampleKind = 'kitchen' | 'cash' | 'test';
/** Cuántas horas hacia atrás se muestran los tickets que no salieron */
const ALERT_HOURS = 12;
/** Nombres típicos de impresoras térmicas, para sugerir la comandera */
const THERMAL = /xprinter|xp-|pos-?80|80c|80 ?mm|thermal|receipt|t[eé]rmica/i;

export const printingService = {
  /** Comanda de cocina de un pedido de mesa: lo que sigue en pie, sin bebidas. null = no lleva comanda. */
  async printOrder(opts: { restaurantId: number; orderId: number }) {
    const order = await prisma.order.findFirst({
      where: { id: opts.orderId, restaurantId: opts.restaurantId },
      include: { items: { where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } }, table: true, createdBy: { select: { name: true } } },
    });
    if (!order) throw HttpError.notFound('Pedido no encontrado');
    if (order.items.length === 0) throw HttpError.badRequest('El pedido no tiene platos para imprimir');
    const goesToKitchen = await kitchenFilter(opts.restaurantId, order.items.map(i => i.menuItemId));
    const kitchenItems = order.items.filter(i => goesToKitchen(i.menuItemId));
    if (kitchenItems.length === 0) return null;

    const isTakeaway = typeof order.notes === 'string' && order.notes.startsWith('PARA LLEVAR:');
    const job = await enqueuePrint(opts.restaurantId, {
      type: 'kitchen',
      tableNumber: order.table.number,
      orderNumber: order.id,
      isTakeaway,
      takeawayName: isTakeaway ? order.notes!.replace('PARA LLEVAR:', '').trim() : null,
      waiterName: order.createdBy?.name ?? null,
      notes: isTakeaway ? null : order.notes,
      items: kitchenItems.map(i => ({
        name: i.itemName,
        quantity: i.quantity,
        notes: itemNotesForPrint(i.modifiers, i.notes),
        note: i.notes,
        modifiers: modifierLines(i.modifiers),
      })),
    });
    return jobView(job);
  },

  /** Comanda de cocina de un pedido para llevar, sin bebidas. null = no lleva comanda. */
  async printTakeawayKitchen(opts: { restaurantId: number; takeawayId: number }) {
    const order = await prisma.takeawayOrder.findFirst({
      where: { id: opts.takeawayId, restaurantId: opts.restaurantId },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (!order) throw HttpError.notFound('Pedido para llevar no encontrado');
    const goesToKitchen = await kitchenFilter(opts.restaurantId, order.items.map(i => i.menuItemId));
    const kitchenItems = order.items.filter(i => goesToKitchen(i.menuItemId));
    if (order.items.length > 0 && kitchenItems.length === 0) return null;
    const job = await enqueuePrint(opts.restaurantId, {
      type: 'kitchen',
      tableNumber: 0,
      orderNumber: order.id,
      isTakeaway: true,
      takeawayName: order.customerName,
      notes: order.notes,
      items: kitchenItems.map(i => ({
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

  /** Volver a intentar un ticket que no salió (el mismo trabajo, desde cero) */
  async retry(restaurantId: number, jobId: number) {
    const res = await prisma.printJob.updateMany({
      where: { id: jobId, restaurantId, status: { in: ['FAILED', 'PENDING'] } },
      data: { status: 'PENDING', error: null, attempts: 0, queuedAt: new Date() },
    });
    if (res.count !== 1) throw HttpError.notFound('No hay un ticket para reintentar con ese número');
    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    emitJobUpdated(job);
    void kickPrinter(restaurantId);
    return jobView(job);
  },

  /** "Ya está": se resolvió sin imprimir (por ejemplo, se lo dijeron a cocina de palabra) */
  async discard(restaurantId: number, jobId: number) {
    const res = await prisma.printJob.updateMany({
      where: { id: jobId, restaurantId, status: { in: ['FAILED', 'PENDING'] } },
      data: { status: 'DISCARDED' },
    });
    if (res.count !== 1) throw HttpError.notFound('No hay un ticket pendiente con ese número');
    const job = await prisma.printJob.findUniqueOrThrow({ where: { id: jobId } });
    emitJobUpdated(job);
    return jobView(job);
  },

  /** Estado de la impresora y tickets que no salieron (para la alerta de Caja y la Comandera) */
  async status(restaurantId: number) {
    const r = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { printerName: true } });
    const since = new Date(Date.now() - ALERT_HOURS * 3600_000);
    const [failed, pending] = await Promise.all([
      prisma.printJob.findMany({
        where: { restaurantId, status: 'FAILED', queuedAt: { gte: since } },
        orderBy: { id: 'desc' },
        take: 20,
      }),
      prisma.printJob.count({ where: { restaurantId, status: 'PENDING' } }),
    ]);
    const st = printerState(restaurantId);
    return {
      printerName: r?.printerName ?? null,
      active: env.PRINTER_WORKER === 'on' && !!r?.printerName,
      workerOn: env.PRINTER_WORKER === 'on',
      lastOkAt: st.lastOkAt,
      lastError: st.lastError,
      lastErrorAt: st.lastErrorAt,
      pending,
      failed: failed.map(jobView),
    };
  },

  /** Impresoras instaladas en la PC del servidor (para elegir la comandera) */
  async printers() {
    if (process.platform !== 'win32') return { supported: false, printers: [], suggested: null };
    try {
      const printers = await listWindowsPrinters();
      const suggested = printers.find(p => THERMAL.test(`${p.name} ${p.driver ?? ''}`))?.name ?? null;
      return { supported: true, printers, suggested };
    } catch (err) {
      throw new HttpError(503, `No se pudo leer la lista de impresoras de Windows: ${err instanceof Error ? err.message : String(err)}`);
    }
  },

  /** Ticket de ejemplo con el nombre y el ancho de papel del local (no se guarda ni se imprime) */
  async sample(restaurantId: number, kind: SampleKind, paperWidth?: PaperWidth) {
    const { header } = await ticketHeader(restaurantId);
    return buildTicket(sampleTicket(kind), paperWidth ? { ...header, paperWidth } : header);
  },

  /** Imprimir el ejemplo o la hoja de prueba (para probar la comandera) */
  async printSample(restaurantId: number, kind: SampleKind) {
    return jobView(await enqueuePrint(restaurantId, sampleTicket(kind)));
  },

  async getSettings(restaurantId: number) {
    const r = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { printPaperWidth: true, printerName: true } });
    return { paperWidth: (r?.printPaperWidth === 58 ? 58 : 80) as PaperWidth, printerName: r?.printerName ?? null };
  },

  async setSettings(
    restaurantId: number,
    changes: { paperWidth?: PaperWidth; printerName?: string | null },
    userId: number | null,
  ) {
    const printerName = changes.printerName === undefined ? undefined : (changes.printerName?.trim() || null);
    let printerChanged = false;
    await prisma.$transaction(async (tx) => {
      const before = await tx.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { printPaperWidth: true, printerName: true } });
      const data: { printPaperWidth?: number; printerName?: string | null } = {};
      if (changes.paperWidth !== undefined) data.printPaperWidth = changes.paperWidth;
      if (printerName !== undefined) data.printerName = printerName;
      printerChanged = printerName !== undefined && printerName !== before.printerName;
      await tx.restaurant.update({ where: { id: restaurantId }, data });
      if (printerChanged && printerName) {
        // Lo que quedó esperando de antes de tener impresora no sale de golpe: se descarta
        // (lo de los últimos minutos sí se imprime, por si la estaban configurando en pleno servicio)
        await tx.printJob.updateMany({
          where: { restaurantId, status: 'PENDING', queuedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
          data: { status: 'DISCARDED', error: 'Quedó de antes de elegir la impresora' },
        });
      }
      await audit(tx, {
        restaurantId, action: 'printing.settings', entity: 'Restaurant', entityId: restaurantId,
        userId: userId ?? undefined,
        before: { paperWidth: before.printPaperWidth, printerName: before.printerName },
        after: { paperWidth: data.printPaperWidth ?? before.printPaperWidth, printerName: data.printerName === undefined ? before.printerName : data.printerName },
      });
    });
    if (printerChanged) void kickPrinter(restaurantId);
    return this.getSettings(restaurantId);
  },
};

export { socketJob };
