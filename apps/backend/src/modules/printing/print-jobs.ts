// ──────────────────────────────────────────────
// print-jobs.ts — Cola de impresión (tarea 1.1)
//
// Todo lo que se manda a imprimir pasa por acá:
//   1. se arma el ticket línea por línea (src/shared/ticket.ts) con el ancho de papel del local;
//   2. se guarda como trabajo (print_jobs, estado PENDING) para verlo en la pantalla "Comandera";
//   3. se emite por socket (la pantalla lo muestra al instante) y se avisa a la cola de
//      impresión (printer-worker.ts), que lo manda a la impresora configurada del local.
// Los trabajos de más de 30 días se borran solos.
// ──────────────────────────────────────────────
import type { PrintJob, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { APP_TIME_ZONE } from '../../lib/time.js';
import { currentContext } from '../../lib/request-context.js';
import { toEscPos } from '../../lib/escpos.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';
import { tableLabel } from '../../shared/table-label.js';
import { buildTicket, printCopies, ticketTitle, type PaperWidth, type PrintPayload, type TicketDoc } from '../../shared/ticket.js';

const RETENTION_DAYS = 30;
let lastPrune = 0;
let onQueued: (() => void) | null = null;

/** La cola de impresión se anota acá para enterarse al instante de cada ticket nuevo */
export function onPrintQueued(fn: () => void) {
  onQueued = fn;
}

/** Cómo se ve un trabajo en la API y en el socket */
export function jobView(job: PrintJob) {
  return {
    id: job.id,
    kind: job.kind,
    title: job.title,
    status: job.status,
    error: job.error,
    attempts: job.attempts,
    reprintOfId: job.reprintOfId,
    createdAt: job.createdAt,
    queuedAt: job.queuedAt,
    printedAt: job.printedAt,
    doc: job.doc as unknown as TicketDoc,
  };
}

/** Avisa a las pantallas que un trabajo cambió de estado */
export function emitJobUpdated(job: PrintJob) {
  ioRestaurant(job.restaurantId).emit(SocketEvents.PRINT_JOB_UPDATED, jobView(job));
}

export function paperWidthOf(value: number | null | undefined): PaperWidth {
  return value === 58 ? 58 : 80;
}

/** Datos del encabezado y ancho de papel del local */
export async function ticketHeader(restaurantId: number, printedAt = new Date()) {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true, address: true, phone: true, printPaperWidth: true, tableLabelMode: true },
  });
  return {
    header: {
      restaurantName: r?.name ?? 'RestOS',
      address: r?.address ?? null,
      phone: r?.phone ?? null,
      printedAt,
      timeZone: APP_TIME_ZONE,
      paperWidth: paperWidthOf(r?.printPaperWidth),
    },
    labelMode: r?.tableLabelMode,
  };
}

/**
 * Los bytes del trabajo, con todas sus copias seguidas y cada una con su corte. Van
 * juntas a la impresora: si falla, el reintento no deja copias de más ni de menos.
 */
export function jobEscPos(job: PrintJob): Buffer {
  const once = toEscPos(job.doc as unknown as TicketDoc);
  const copies = printCopies(job.payload as unknown as PrintPayload);
  return Buffer.concat(Array.from({ length: copies }, () => once));
}

/** Lo que recibe el agente y la pantalla por socket */
export function socketJob(job: PrintJob) {
  const doc = job.doc as unknown as TicketDoc;
  return {
    ...(job.payload as unknown as PrintPayload),
    jobId: job.id,
    title: job.title,
    status: job.status,
    createdAt: job.createdAt,
    paperWidth: doc.paperWidth,
    doc,
    escpos: jobEscPos(job).toString('base64'),
  };
}

export async function enqueuePrint(
  restaurantId: number,
  payload: PrintPayload,
  opts: { reprintOfId?: number } = {},
): Promise<PrintJob> {
  const { header, labelMode } = await ticketHeader(restaurantId);

  // La mesa como la llama el local ("Ventana" o "Mesa 5"), si quien imprime no la trajo
  if (payload.tableLabel === undefined && payload.tableNumber && !payload.isTakeaway) {
    const t = await prisma.table.findUnique({
      where: { restaurantId_number: { restaurantId, number: payload.tableNumber } },
      select: { number: true, name: true },
    });
    payload = { ...payload, tableName: t?.name ?? null, tableLabel: tableLabel(t ?? { number: payload.tableNumber }, labelMode) };
  }

  const doc = buildTicket(payload, header);
  const job = await prisma.printJob.create({
    data: {
      restaurantId,
      kind: payload.type,
      title: ticketTitle(payload).slice(0, 160),
      payload: payload as unknown as Prisma.InputJsonValue,
      doc: doc as unknown as Prisma.InputJsonValue,
      reprintOfId: opts.reprintOfId ?? null,
      createdById: currentContext()?.userId ?? null,
    },
  });
  ioRestaurant(restaurantId).emit(SocketEvents.PRINT_REQUEST, socketJob(job));
  logger.info('print_requested', { kind: payload.type, restaurantId, jobId: job.id });
  onQueued?.();
  void prune();
  return job;
}

/** Para quien imprime sin esperar (por ejemplo el ticket de un cambio de plato) */
export function emitPrintRequest(restaurantId: number, payload: PrintPayload): void {
  enqueuePrint(restaurantId, payload).catch((err) => {
    logger.error('print_enqueue_failed', { restaurantId, error: err instanceof Error ? err.message : String(err) });
  });
}

async function prune() {
  if (Date.now() - lastPrune < 3600_000) return;
  lastPrune = Date.now();
  try {
    await prisma.printJob.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86_400_000) } } });
  } catch (err) {
    logger.warn('print_prune_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
