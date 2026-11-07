// ──────────────────────────────────────────────
// request-context.ts — Quién hace la operación en curso
//
// `authenticate` guarda acá al usuario del token; la auditoría lo lee sin que
// cada servicio tenga que recibir el usuario por parámetro. Usa
// AsyncLocalStorage (Node, sin dependencias): el valor acompaña a todo el
// trabajo asíncrono de ese pedido HTTP y a nada más.
// ──────────────────────────────────────────────
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  userId: number | null;
  restaurantId: number | null;
  requestId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}
