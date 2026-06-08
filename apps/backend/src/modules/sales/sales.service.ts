// ──────────────────────────────────────────────
// sales.service.ts — Registro de ventas
//
// Flujo de cobro:
// 1. Mesa con orders abiertos
// 2. POST /api/sales con { tableId, paymentMethod, amount, notes?, imageBase64? }
// 3. Calcula total desde orders abiertos
// 4. Si hay imagen base64, la guarda en /uploads/sales/<timestamp>-<rand>.<ext>
// 5. En una transacción:
//    - Crea el registro de Sale
//    - Borra los Orders (que cascada borra OrderItems)
//    - Cierra la mesa (vuelve a AVAILABLE, limpia guestCount/openedAt)
// 6. Emite sale:registered y table:changed
// ──────────────────────────────────────────────
import { PaymentMethod, TableStatus, type Sale } from '@prisma/client';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';
import { getIO, SocketEvents } from '../../sockets/index.js';

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

function emitSaleRegistered(sale: Sale) {
  getIO().emit(SocketEvents.SALE_REGISTERED, sale);
}
function emitTableChanged(table: unknown) {
  getIO().emit(SocketEvents.TABLE_CHANGED, table);
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
  async list(filters: SalesListFilters = {}): Promise<Sale[]> {
    return prisma.sale.findMany({
      where: {
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

  async getById(id: number): Promise<Sale> {
    const sale = await prisma.sale.findUnique({ where: { id } });
    if (!sale) throw HttpError.notFound('Venta no encontrada');
    return sale;
  },

  /**
   * Registra venta + cierra mesa + borra orders, todo en una transacción.
   * Guarda un snapshot de items en sale_items para reportes posteriores.
   */
  async create(input: CreateSaleInput): Promise<Sale> {
    const table = await prisma.table.findUnique({
      where: { id: input.tableId },
      include: {
        orders: {
          include: {
            items: { include: { menuItem: true } },
          },
        },
      },
    });
    if (!table) throw HttpError.notFound('Mesa no encontrada');
    if (table.status === TableStatus.AVAILABLE) {
      throw HttpError.badRequest('La mesa no tiene cuenta abierta');
    }

    // Calcular total real desde los items + construir snapshot agregado
    // (un mismo item puede aparecer en varios pedidos: lo sumamos en un único SaleItem)
    let total = 0;
    const snapshot = new Map<string, {
      menuItemId: number | null;
      itemName: string;
      category: string;
      quantity: number;
      price: number;
    }>();

    for (const order of table.orders) {
      for (const item of order.items) {
        const lineTotal = Number(item.price) * item.quantity;
        total += lineTotal;
        // Clave de agrupación: menuItemId + price (mismo item con mismo precio se agrupa)
        const key = `${item.menuItemId ?? `name:${item.itemName}`}-${item.price}`;
        const existing = snapshot.get(key);
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          snapshot.set(key, {
            menuItemId: item.menuItemId,
            itemName: item.itemName,
            category: item.menuItem?.category ?? 'unknown',
            quantity: item.quantity,
            price: Number(item.price),
          });
        }
      }
    }

    if (input.amount < 0) {
      throw HttpError.badRequest('El monto cobrado no puede ser negativo');
    }

    // Guardar imagen si vino
    let imageUrl: string | null = null;
    if (input.imageBase64) {
      imageUrl = await saveBase64Image(input.imageBase64);
    }

    const tableNumber = table.number;
    const orderIds = table.orders.map(o => o.id);

    // Transacción: crear sale + saleItems + borrar orders + cerrar mesa
    const { sale, updatedTable } = await prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          tableId: input.tableId,
          tableNumber,
          paymentMethod: input.paymentMethod,
          amount: input.amount,
          total,
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
            price: s.price,
            subtotal: s.price * s.quantity,
          })),
        });
      }

      if (orderIds.length > 0) {
        // Cascade borra OrderItems
        await tx.order.deleteMany({ where: { id: { in: orderIds } } });
      }

      const updatedTable = await tx.table.update({
        where: { id: input.tableId },
        data: {
          status: TableStatus.AVAILABLE,
          guestCount: null,
          openedAt: null,
        },
      });

      return { sale, updatedTable };
    });

    emitSaleRegistered(sale);
    emitTableChanged(updatedTable);

    return sale;
  },

  /**
   * Estadísticas del día: total facturado, conteo, breakdown por método.
   */
  async dailyStats(date: Date = new Date()): Promise<{
    total: number;
    count: number;
    byMethod: Record<PaymentMethod, { count: number; amount: number }>;
  }> {
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(23, 59, 59, 999);

    const sales = await prisma.sale.findMany({
      where: { closedAt: { gte: dayStart, lte: dayEnd } },
    });

    const byMethod: Record<PaymentMethod, { count: number; amount: number }> = {
      CASH:     { count: 0, amount: 0 },
      CARD:     { count: 0, amount: 0 },
      TRANSFER: { count: 0, amount: 0 },
    };
    let total = 0;
    for (const s of sales) {
      const amount = Number(s.amount);
      total += amount;
      byMethod[s.paymentMethod].count += 1;
      byMethod[s.paymentMethod].amount += amount;
    }
    return { total, count: sales.length, byMethod };
  },
};
