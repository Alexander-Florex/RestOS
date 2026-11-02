// ──────────────────────────────────────────────
// sales.service.ts — Registro de ventas
//
// Flujo de cobro:
// 1. Mesa con orders abiertos
// 2. POST /api/sales con { tableId, paymentMethod, amount, notes?, imageBase64? }
// 3. Si hay imagen base64, la guarda en /uploads/sales/<timestamp>-<rand>.<ext>
//    (se borra si el cobro falla)
// 4. En una transacción:
//    - Bloquea la fila de la mesa (lockTable) y valida que tenga cuenta abierta;
//      un segundo cobro simultáneo espera el lock y recibe 409
//    - Calcula el total en centavos desde los orders (leídos DESPUÉS del lock)
//    - Exige amount >= total (no se aceptan cobros parciales)
//    - Crea el registro de Sale + snapshot de items
//    - Marca los pedidos abiertos como PAID vinculados a la venta (no se borran, tarea 1.3)
//    - Cierra la mesa (vuelve a AVAILABLE, limpia guestCount/openedAt)
// 5. Emite sale:registered y table:changed
// ──────────────────────────────────────────────
import { OrderStatus, PaymentMethod, SaleChannel, TableStatus, type Sale, type Prisma } from '@prisma/client';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { lockTable } from '../../lib/table-lock.js';
import { toCents, fromCents, formatCents, collectedCents } from '../../lib/money.js';
import { localDayKey, localDaysRange, type DayKey } from '../../lib/time.js';
import { modifiersKey } from '../../lib/modifiers.js';
import { ioRestaurant, SocketEvents } from '../../sockets/index.js';
import { audit } from '../../lib/audit.js';

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads', 'sales');

// Asegurarse de que el directorio existe
async function ensureUploadsDir() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

/**
 * Guarda una imagen recibida en base64.
 * Acepta "data:image/jpeg;base64,..." o solo el cuerpo en base64.
 * Devuelve la URL pública relativa.
 */
async function saveBase64Image(b64: string): Promise<string> {
  await ensureUploadsDir();

  // Extraer mime y data
  const match = b64.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  let ext = 'jpg';
  let data = b64;
  if (match) {
    ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    data = match[2];
  }

  const buffer = Buffer.from(data, 'base64');
  if (buffer.length === 0) throw HttpError.badRequest('Imagen inválida');
  if (buffer.length > 8 * 1024 * 1024) throw HttpError.badRequest('Imagen demasiado grande (máx 8MB)');

  const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  const fullPath = path.join(UPLOADS_DIR, filename);
  await fs.writeFile(fullPath, buffer);

  return `/uploads/sales/${filename}`;
}

/** Borra una imagen guardada por saveBase64Image (si el cobro no se concretó). */
async function removeSavedImage(url: string) {
  await fs.rm(path.join(UPLOADS_DIR, path.basename(url)), { force: true });
}

/** Estados en los que la mesa tiene una cuenta abierta que se puede cobrar. */
const PAYABLE_STATUSES: TableStatus[] = [TableStatus.OCCUPIED, TableStatus.BILL_REQUESTED];

function emitSaleRegistered(restaurantId: number, sale: Sale) {
  ioRestaurant(restaurantId).emit(SocketEvents.SALE_REGISTERED, sale);
}
function emitTableChanged(restaurantId: number, table: unknown) {
  ioRestaurant(restaurantId).emit(SocketEvents.TABLE_CHANGED, table);
}

export interface CreateSaleInput {
  tableId: number;
  paymentMethod: PaymentMethod;
  amount: number;
  notes?: string;
  imageBase64?: string;
  registeredById?: number;
}

export interface SalesListFilters {
  from?: Date;
  to?: Date;
  paymentMethod?: PaymentMethod;
}

export const salesService = {
  async list(restaurantId: number, filters: SalesListFilters = {}): Promise<Sale[]> {
    return prisma.sale.findMany({
      where: {
        restaurantId,
        ...((filters.from || filters.to) ? {
          closedAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        } : {}),
        ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod } : {}),
      },
      orderBy: { closedAt: 'desc' },
    });
  },

  async getById(restaurantId: number, id: number): Promise<Sale> {
    const sale = await prisma.sale.findFirst({ where: { id, restaurantId } });
    if (!sale) throw HttpError.notFound('Venta no encontrada');
    return sale;
  },

  /**
   * Ruta en disco del comprobante de una venta del restaurante.
   * Solo el nombre de archivo guardado en la venta: no se puede pedir otro archivo.
   */
  async receiptFile(restaurantId: number, id: number): Promise<string> {
    const sale = await salesService.getById(restaurantId, id);
    if (!sale.imageUrl) throw HttpError.notFound('La venta no tiene comprobante');
    const fullPath = path.join(UPLOADS_DIR, path.basename(sale.imageUrl));
    try {
      await fs.access(fullPath);
    } catch {
      throw HttpError.notFound('No se encontró el archivo del comprobante');
    }
    return fullPath;
  },

  /**
   * Registra venta + cierra mesa + marca los pedidos como cobrados, todo en una transacción.
   * Guarda un snapshot de items en sale_items para reportes posteriores.
   *
   * Concurrencia: la mesa se bloquea con SELECT ... FOR UPDATE antes de leer
   * sus pedidos. Un segundo cobro de la misma mesa espera y recibe 409; un
   * pedido nuevo (orders.service también bloquea la mesa) entra antes o
   * después del cobro, nunca en el medio.
   */
  async create(restaurantId: number, input: CreateSaleInput): Promise<Sale> {
    const amountCents = toCents(input.amount);
    if (amountCents < 0) {
      throw HttpError.badRequest('El monto cobrado no puede ser negativo');
    }

    // Guardar imagen si vino (fuera de la transacción: es I/O de disco)
    let imageUrl: string | null = null;
    if (input.imageBase64) {
      imageUrl = await saveBase64Image(input.imageBase64);
    }

    try {
      const { sale, updatedTable } = await prisma.$transaction(async (tx) => {
        // 1. Bloquear la mesa: tiene que ser la primera lectura de la transacción
        const locked = await lockTable(tx, restaurantId, input.tableId);
        if (!locked) throw HttpError.notFound('Mesa no encontrada');
        if (!PAYABLE_STATUSES.includes(locked.status)) {
          throw HttpError.conflict('La mesa ya fue cobrada o no tiene una cuenta abierta');
        }

        // 2. Leer pedidos con la mesa ya bloqueada
        const orders = await tx.order.findMany({
          // Solo la cuenta abierta: los cobrados/anulados de antes quedan en el historial
          where: { tableId: input.tableId, restaurantId, status: OrderStatus.OPEN },
          include: { items: { include: { menuItem: true } } },
        });

        // Calcular total real desde los items + construir snapshot agregado
        // (un mismo item puede aparecer en varios pedidos: lo sumamos en un único SaleItem)
        let totalCents = 0;
        const snapshot = new Map<string, {
          menuItemId: number | null;
          itemName: string;
          category: string;
          quantity: number;
          priceCents: number;
          modifiers: Prisma.JsonValue | null;
        }>();

        for (const order of orders) {
          for (const item of order.items) {
            const priceCents = toCents(item.price);
            totalCents += priceCents * item.quantity;
            // Clave de agrupación: plato + precio + opciones elegidas. Dos César "sin
            // croutones" se suman; una César común queda en otra línea.
            const key = `${item.menuItemId ?? `name:${item.itemName}`}-${priceCents}-${modifiersKey(item.modifiers)}`;
            const existing = snapshot.get(key);
            if (existing) {
              existing.quantity += item.quantity;
            } else {
              snapshot.set(key, {
                menuItemId: item.menuItemId,
                itemName: item.itemName,
                category: item.menuItem?.category ?? 'unknown',
                quantity: item.quantity,
                priceCents,
                modifiers: item.modifiers,
              });
            }
          }
        }

        // Una mesa abierta sin consumo se libera sin venta (tables/:id/close),
        // así no quedan ventas de $0 en caja y reportes.
        if (totalCents === 0) {
          throw HttpError.badRequest('La mesa no tiene consumos para cobrar. Liberala sin venta.');
        }

        // 3. No se aceptan cobros parciales. Si entró un pedido mientras se
        //    cobraba, el total subió y el monto de la pantalla ya no alcanza.
        if (amountCents < totalCents) {
          throw HttpError.badRequest(
            `El monto cobrado (${formatCents(amountCents)}) no cubre el total de la cuenta ` +
            `(${formatCents(totalCents)}). Si se agregaron pedidos, revisá la cuenta y volvé a cobrar.`,
          );
        }

        // 4. Cerrar la mesa (el where por estado es una segunda garantía además del lock)
        const closed = await tx.table.updateMany({
          where: { id: input.tableId, restaurantId, status: { in: PAYABLE_STATUSES } },
          data: {
            status: TableStatus.AVAILABLE,
            guestCount: null,
            openedAt: null,
          },
        });
        if (closed.count !== 1) {
          throw HttpError.conflict('La mesa ya fue cobrada o no tiene una cuenta abierta');
        }

        const sale = await tx.sale.create({
          data: {
            restaurantId,
            tableId: input.tableId,
            channel: SaleChannel.DINE_IN,
            tableNumber: locked.number,
            paymentMethod: input.paymentMethod,
            amount: fromCents(amountCents),
            total: fromCents(totalCents),
            notes: input.notes ?? null,
            imageUrl,
            registeredById: input.registeredById ?? null,
            closedAt: new Date(),
          },
        });

        // Snapshot de items consumidos (para reportes)
        if (snapshot.size > 0) {
          await tx.saleItem.createMany({
            data: Array.from(snapshot.values()).map(s => ({
              saleId: sale.id,
              menuItemId: s.menuItemId,
              itemName: s.itemName,
              category: s.category,
              quantity: s.quantity,
              price: fromCents(s.priceCents),
              subtotal: fromCents(s.priceCents * s.quantity),
              modifiers: s.modifiers ?? undefined,
            })),
          });
        }

        // Los pedidos cobrados quedan en el historial, vinculados a la venta.
        // Se marcan exactamente los que se sumaron (leídos con la mesa bloqueada).
        const paid = await tx.order.updateMany({
          where: { id: { in: orders.map(o => o.id) }, restaurantId, status: OrderStatus.OPEN },
          data: { status: OrderStatus.PAID, saleId: sale.id, closedAt: sale.closedAt },
        });
        if (paid.count !== orders.length) {
          throw HttpError.conflict('Los pedidos de la mesa cambiaron durante el cobro. Volvé a intentarlo.');
        }

        await audit(tx, {
          restaurantId, action: 'sale.create', entity: 'Sale', entityId: sale.id,
          userId: input.registeredById ?? undefined,
          after: {
            tableNumber: locked.number, paymentMethod: input.paymentMethod,
            total: sale.total, amount: sale.amount, orderIds: orders.map(o => o.id),
            notes: input.notes ?? null, receipt: !!imageUrl,
          },
        });

        const updatedTable = await tx.table.findUniqueOrThrow({ where: { id: input.tableId } });
        return { sale, updatedTable };
      });

      emitSaleRegistered(restaurantId, sale);
      emitTableChanged(restaurantId, updatedTable);

      return sale;
    } catch (err) {
      if (imageUrl) await removeSavedImage(imageUrl).catch(() => {});
      throw err;
    }
  },

  /**
   * Estadísticas de un día local del restaurante (hoy por defecto):
   * total cobrado, conteo, breakdown por método.
   */
  async dailyStats(restaurantId: number, day: DayKey = localDayKey(new Date())): Promise<{
    total: number;
    count: number;
    byMethod: Record<PaymentMethod, { count: number; amount: number }>;
  }> {
    const { from: dayStart, to: dayEnd } = localDaysRange(day);

    const sales = await prisma.sale.findMany({
      where: { restaurantId, closedAt: { gte: dayStart, lte: dayEnd } },
    });

    const byMethod: Record<PaymentMethod, { count: number; amount: number }> = {
      CASH:     { count: 0, amount: 0 },
      CARD:     { count: 0, amount: 0 },
      TRANSFER: { count: 0, amount: 0 },
    };
    let totalCents = 0;
    const byMethodCents: Record<PaymentMethod, number> = { CASH: 0, CARD: 0, TRANSFER: 0 };
    for (const s of sales) {
      // amount es lo que entregó el cliente (incluye el vuelto): lo cobrado es min(amount, total)
      const collected = collectedCents(s);
      totalCents += collected;
      byMethod[s.paymentMethod].count += 1;
      byMethodCents[s.paymentMethod] += collected;
    }
    for (const m of Object.keys(byMethodCents) as PaymentMethod[]) {
      byMethod[m].amount = fromCents(byMethodCents[m]);
    }
    return { total: fromCents(totalCents), count: sales.length, byMethod };
  },
};
