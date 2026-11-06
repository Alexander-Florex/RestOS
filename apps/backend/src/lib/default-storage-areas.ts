// ──────────────────────────────────────────────
// default-storage-areas.ts — Sectores con los que arranca un restaurante (tarea 3.1)
// Los 7 de la planilla de stock del cliente (CLAUDE.md, sección 7.1).
// Sin dependencias de sockets ni de la app: lo usan también los scripts de alta.
// ──────────────────────────────────────────────
import type { Prisma, PrismaClient } from '@prisma/client';

export const DEFAULT_STORAGE_AREAS = [
  'Carnes, pescados y mariscos',
  'Pastas',
  'Guarniciones y salsas',
  'Cámara / heladera',
  'Vegetales en depósito',
  'Estanterías depósito',
  'Limpieza y descartables',
] as const;

/** Crea los sectores por defecto (no duplica si ya existen). */
export async function createDefaultStorageAreas(db: PrismaClient | Prisma.TransactionClient, restaurantId: number) {
  await db.storageArea.createMany({
    data: DEFAULT_STORAGE_AREAS.map((name, i) => ({ restaurantId, name, sortOrder: i + 1 })),
    skipDuplicates: true,
  });
}
