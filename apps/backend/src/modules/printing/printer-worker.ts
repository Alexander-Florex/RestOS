// ──────────────────────────────────────────────
// printer-worker.ts — La cola que imprime de verdad (tarea 1.1, parte 2).
//
// La comandera (Xprinter XP-V320N) está enchufada por USB a la PC del servidor, así
// que el mismo backend imprime: no hace falta un programa aparte ni otro usuario.
// Para cada local con impresora configurada (`restaurants.printerName`):
//   - toma los tickets PENDING en orden de llegada y los manda uno por uno;
//   - si salió: PRINTED. Si falló: lo reintenta solo (hasta 3 veces, cada 10 s) y
//     después queda FAILED, con el motivo: la pantalla muestra una alerta con
//     "Reintentar" y "Ya está";
//   - un ticket que esperó más de 30 minutos (servidor apagado, impresora sin
//     configurar un rato) no se imprime tarde: queda FAILED para decidir a mano.
// Los datos viven en la base: si el servidor se reinicia, sigue donde quedó.
// ──────────────────────────────────────────────
import type { PrintJob, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { realTransport, type PrinterTransport } from '../../lib/printers/index.js';
import { emitJobUpdated, jobEscPos, onPrintQueued } from './print-jobs.js';

export const MAX_ATTEMPTS = 3;
export const RETRY_MS = 10_000;
export const MAX_WAIT_MS = 30 * 60_000;
const POLL_MS = 5_000;

export interface PrinterState {
  lastOkAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  /** Hasta cuándo se espera antes de volver a probar (impresora con problemas) */
  retryAt: number;
}

const states = new Map<number, PrinterState>();
let transport: PrinterTransport = realTransport;
let timer: NodeJS.Timeout | null = null;
let busy: Promise<void> | null = null;
let again = false;

export function printerState(restaurantId: number): PrinterState {
  let s = states.get(restaurantId);
  if (!s) {
    s = { lastOkAt: null, lastError: null, lastErrorAt: null, retryAt: 0 };
    states.set(restaurantId, s);
  }
  return s;
}

/** Revisa la cola ya (ticket nuevo, reintento a mano o impresora recién elegida) */
export function kickPrinter(restaurantId?: number): Promise<void> {
  if (restaurantId !== undefined) printerState(restaurantId).retryAt = 0;
  if (busy) { again = true; return busy; }
  busy = (async () => {
    try {
      do { again = false; await drain(); } while (again);
    } catch (err) {
      logger.error('printer_worker_failed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      busy = null;
    }
  })();
  return busy;
}

/** Arranca la cola (lo llama index.ts). Los tests pasan su propia "impresora". */
export function startPrinterWorker(opts: { transport?: PrinterTransport; pollMs?: number } = {}) {
  if (opts.transport) transport = opts.transport;
  onPrintQueued(() => { void kickPrinter(); });
  if (!timer && opts.pollMs !== 0) {
    timer = setInterval(() => { void kickPrinter(); }, opts.pollMs ?? POLL_MS);
    timer.unref();
  }
  void kickPrinter();
}

export function stopPrinterWorker() {
  if (timer) clearInterval(timer);
  timer = null;
  onPrintQueued(() => {});
}

/** Solo para tests: vuelve a cero el estado en memoria */
export function resetPrinterStates() {
  states.clear();
}

async function update(job: PrintJob, data: Prisma.PrintJobUpdateManyMutationInput): Promise<boolean> {
  // Solo si sigue pendiente: si alguien lo descartó mientras tanto, no se pisa
  const res = await prisma.printJob.updateMany({ where: { id: job.id, status: 'PENDING' }, data });
  if (res.count !== 1) return false;
  emitJobUpdated(await prisma.printJob.findUniqueOrThrow({ where: { id: job.id } }));
  return true;
}

async function drain() {
  const locales = await prisma.restaurant.findMany({
    where: { printerName: { not: null } },
    select: { id: true, printerName: true },
  });
  for (const r of locales) {
    const target = r.printerName?.trim();
    if (!target) continue;

    // Los que esperaron demasiado no salen tarde: quedan para decidir a mano
    const stale = await prisma.printJob.findMany({
      where: { restaurantId: r.id, status: 'PENDING', queuedAt: { lt: new Date(Date.now() - MAX_WAIT_MS) } },
      select: { id: true },
    });
    for (const { id } of stale) {
      const res = await prisma.printJob.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'FAILED', error: 'No se imprimió a tiempo (esperó más de 30 minutos). Reintentalo si todavía hace falta.' },
      });
      if (res.count === 1) emitJobUpdated(await prisma.printJob.findUniqueOrThrow({ where: { id } }));
    }

    const st = printerState(r.id);
    if (st.retryAt > Date.now()) continue;

    for (;;) {
      const job = await prisma.printJob.findFirst({ where: { restaurantId: r.id, status: 'PENDING' }, orderBy: { id: 'asc' } });
      if (!job) break;
      if (!(await printOne(target, job, st))) break; // impresora con problemas: se espera y se vuelve a probar
    }
  }
}

async function printOne(target: string, job: PrintJob, st: PrinterState): Promise<boolean> {
  const data = jobEscPos(job);
  try {
    await transport.print(target, job.title, data);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 480);
    const attempts = job.attempts + 1;
    st.lastError = message;
    st.lastErrorAt = new Date();
    st.retryAt = Date.now() + RETRY_MS;
    if (attempts >= MAX_ATTEMPTS) {
      await update(job, { status: 'FAILED', attempts, error: message });
      // El que sigue se prueba enseguida: si la impresora volvió, no espera
      st.retryAt = 0;
      logger.warn('print_failed', { jobId: job.id, restaurantId: job.restaurantId, attempts, error: message });
      return true;
    }
    await update(job, { attempts, error: `Reintentando (${attempts} de ${MAX_ATTEMPTS}): ${message}` });
    logger.warn('print_retry', { jobId: job.id, restaurantId: job.restaurantId, attempts, error: message });
    // Reintento en 10 s aunque no llegue nada nuevo
    setTimeout(() => { void kickPrinter(); }, RETRY_MS + 100).unref();
    return false;
  }
  st.lastOkAt = new Date();
  st.lastError = null;
  st.lastErrorAt = null;
  st.retryAt = 0;
  await update(job, { status: 'PRINTED', printedAt: new Date(), error: null });
  logger.info('print_done', { jobId: job.id, restaurantId: job.restaurantId });
  return true;
}
