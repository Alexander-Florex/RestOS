// ──────────────────────────────────────────────
// order-queue.ts — Pedidos tomados sin conexión (tarea 1.5)
//
// Si al enviar un pedido no hay conexión con el servidor, el pedido queda
// guardado en este dispositivo y se reenvía solo cuando vuelve la conexión.
// Cada pedido lleva un clientRequestId: si el servidor ya lo había recibido
// (se perdió solo la respuesta), devuelve el mismo pedido y no lo duplica.
// SOLO pedidos: los cobros nunca se encolan.
// ──────────────────────────────────────────────
import {
  ApiError, ordersApi, printingApi, takeawayApi, tokenStorage,
  type CreateOrderBody, type CreateTakeawayBody,
} from './api';
import { RESYNC_EVENT } from './connection';

export type QueuedKind = 'table' | 'takeaway';

export interface QueuedOrder {
  id: string;
  kind: QueuedKind;
  body: (CreateOrderBody | CreateTakeawayBody) & { clientRequestId: string };
  /** Texto para mostrar: "Mesa 3 · 2 ítems" */
  label: string;
  createdAt: number;
  attempts: number;
  /** El servidor lo rechazó (ej. un plato se quedó sin stock): necesita revisión */
  error?: string;
  /** Imprimir la comanda al enviarlo (panel) */
  print?: boolean;
}

const KEY = 'restos_pending_orders';
const listeners = new Set<(q: QueuedOrder[]) => void>();
let flushing = false;

function load(): QueuedOrder[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedOrder[]) : [];
  } catch {
    return [];
  }
}

function save(queue: QueuedOrder[]) {
  try { localStorage.setItem(KEY, JSON.stringify(queue)); } catch { /* sin almacenamiento: se pierde al recargar */ }
  for (const l of listeners) l(queue);
}

export function getQueue(): QueuedOrder[] {
  return load();
}

export function onQueueChange(cb: (q: QueuedOrder[]) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Id único. crypto.randomUUID solo existe en https/localhost; en la LAN (http) se arma a mano. */
export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Sin respuesta útil del servidor: reintentar es seguro (el id evita duplicados). */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;          // fetch falló: sin red / servidor caído
  return err.status === 0 || err.status >= 500;         // proxy o servidor sin responder
}

async function send(kind: QueuedKind, body: QueuedOrder['body']) {
  return kind === 'table'
    ? (await ordersApi.create(body as CreateOrderBody)).order
    : (await takeawayApi.create(body as CreateTakeawayBody)).order;
}

export type SubmitResult<T> = { status: 'sent'; order: T } | { status: 'queued' };

/**
 * Envía un pedido. Si no hay conexión, lo guarda para reenviarlo solo.
 * Un rechazo del servidor (400, 409...) se lanza como siempre: no se encola.
 */
export async function submitOrder<K extends QueuedKind>(
  kind: K,
  body: K extends 'table' ? CreateOrderBody : CreateTakeawayBody,
  opts: { label: string; print?: boolean },
): Promise<SubmitResult<{ id: number }>> {
  const withId = { ...body, clientRequestId: body.clientRequestId ?? newRequestId() } as QueuedOrder['body'];
  try {
    return { status: 'sent', order: await send(kind, withId) };
  } catch (err) {
    if (!isRetryable(err)) throw err;
    save([...load(), {
      id: withId.clientRequestId, kind, body: withId, label: opts.label,
      createdAt: Date.now(), attempts: 1, print: opts.print,
    }]);
    scheduleRetry();
    return { status: 'queued' };
  }
}

/**
 * Reenvía los pendientes en orden. Se detiene al primer corte (sigue sin red).
 * Devuelve los que se enviaron, para avisar en pantalla.
 */
export async function flushQueue(): Promise<QueuedOrder[]> {
  if (flushing || !tokenStorage.get()) return [];
  flushing = true;
  const sent: QueuedOrder[] = [];
  try {
    for (const item of load()) {
      if (item.error) continue; // rechazados: esperan que alguien los revise
      try {
        const order = await send(item.kind, item.body);
        sent.push(item);
        save(load().filter(q => q.id !== item.id));
        if (item.print && item.kind === 'table') {
          printingApi.printOrder(order.id).catch(() => { /* la comanda se puede reimprimir desde la mesa */ });
        }
      } catch (err) {
        if (isRetryable(err)) {
          save(load().map(q => (q.id === item.id ? { ...q, attempts: q.attempts + 1 } : q)));
          break;
        }
        const message = err instanceof ApiError ? err.message : 'Error al enviar';
        save(load().map(q => (q.id === item.id ? { ...q, error: message, attempts: q.attempts + 1 } : q)));
      }
    }
  } finally {
    flushing = false;
  }
  if (load().some(q => !q.error)) scheduleRetry();
  return sent;
}

/** Quitar un pendiente (después de revisarlo con el cliente). */
export function discardQueued(id: string) {
  save(load().filter(q => q.id !== id));
}

/** Volver a intentar uno que el servidor rechazó (ej. ya hay stock otra vez). */
export function retryQueued(id: string) {
  save(load().map(q => (q.id === id ? { ...q, error: undefined } : q)));
  void flushQueue().then(notifySent);
}

// ── Reintentos automáticos ──
let timer: number | undefined;
let notify: ((sent: QueuedOrder[]) => void) | null = null;

function notifySent(sent: QueuedOrder[]) {
  if (sent.length && notify) notify(sent);
}

function scheduleRetry() {
  if (timer !== undefined) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    void flushQueue().then(notifySent);
  }, 15_000);
}

/** Arranca los reintentos: al volver la conexión, al recuperar red y al iniciar. */
export function startQueue(onSent: (sent: QueuedOrder[]) => void): () => void {
  notify = onSent;
  const run = () => { void flushQueue().then(notifySent); };
  window.addEventListener(RESYNC_EVENT, run);
  window.addEventListener('online', run);
  run();
  return () => {
    notify = null;
    window.removeEventListener(RESYNC_EVENT, run);
    window.removeEventListener('online', run);
  };
}
