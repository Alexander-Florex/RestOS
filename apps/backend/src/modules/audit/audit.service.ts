// ──────────────────────────────────────────────
// audit.service.ts — Consulta del registro de auditoría (solo lectura)
// Los registros se escriben desde cada operación con lib/audit.ts.
// ──────────────────────────────────────────────
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';

export interface AuditQuery {
  from: Date;
  to: Date;
  /**
   * Acciones separadas por coma; cada una exacta ("order.cancel") o prefijo
   * ("inventory" trae todas las de stock). Ej.: "sale.create,takeaway.pay".
   */
  action?: string;
  userId?: number;
  entity?: string;
  entityId?: number;
  page: number;
  pageSize: number;
}

export const auditService = {
  async list(restaurantId: number, q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      restaurantId,
      createdAt: { gte: q.from, lte: q.to },
      ...(q.action ? {
        OR: q.action.split(',').filter(Boolean).map(a =>
          a.includes('.') ? { action: a } : { action: { startsWith: `${a}.` } }),
      } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
    };
    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, entries };
  },

  /** Usuarios que aparecen en el registro (para el filtro), incluidos los ya borrados. */
  async actors(restaurantId: number) {
    const rows = await prisma.auditLog.groupBy({
      by: ['userId', 'userName'],
      where: { restaurantId, userName: { not: null } },
      orderBy: { userName: 'asc' },
    });
    return rows.map(r => ({ userId: r.userId, userName: r.userName! }));
  },
};
