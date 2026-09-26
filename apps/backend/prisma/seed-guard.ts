// ──────────────────────────────────────────────
// seed-guard.ts — Decide si el seed de demo puede correr.
//
// El seed hace deleteMany de TODAS las tablas, así que:
//  - en producción no corre nunca (ni con --force);
//  - si la base ya tiene restaurantes, no corre salvo --force (solo dev).
// ──────────────────────────────────────────────

export interface SeedGuardInput {
  nodeEnv: string | undefined;
  restaurantCount: number;
  force: boolean;
}

export type SeedGuardResult = { ok: true } | { ok: false; reason: string };

export function checkSeedAllowed({ nodeEnv, restaurantCount, force }: SeedGuardInput): SeedGuardResult {
  if (nodeEnv === 'production') {
    return {
      ok: false,
      reason:
        'NODE_ENV=production: el seed borra todos los datos y no se puede correr en producción. ' +
        'Para dar de alta al cliente usá prisma/reset-restaurant.ts.',
    };
  }
  if (restaurantCount > 0 && !force) {
    return {
      ok: false,
      reason:
        `La base ya tiene ${restaurantCount} restaurante(s). El seed borraría todo. ` +
        'Si es una base de desarrollo y querés pisarla, corré el seed con --force.',
    };
  }
  return { ok: true };
}
