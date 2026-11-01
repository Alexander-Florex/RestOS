// ──────────────────────────────────────────────
// login-limiter.ts — Límite de intentos fallidos de login
//
// En memoria: el sistema corre en un solo servidor del local. Reiniciar el
// backend desbloquea a todos (sirve como "desbloqueo de emergencia").
//
// - Por usuario (restaurante + usuario): tras N fallos seguidos, bloqueo temporal.
//   Un login correcto reinicia el contador.
// - Por IP: tope de fallos en una ventana, para frenar a quien prueba muchos
//   usuarios distintos. Es más alto porque varios celulares pueden compartir IP.
// ──────────────────────────────────────────────

export interface LoginLimiterOptions {
  maxUserFailures: number;
  userLockMs: number;
  maxIpFailures: number;
  ipWindowMs: number;
  now?: () => number;
}

interface Counter { failures: number; windowStart: number; lockedUntil: number }

export type LimitCheck = { allowed: true } | { allowed: false; retryAfterSec: number };

const MAX_ENTRIES = 10_000;

export function createLoginLimiter(opts: LoginLimiterOptions) {
  const now = opts.now ?? Date.now;
  const users = new Map<string, Counter>();
  const ips = new Map<string, Counter>();

  function prune(map: Map<string, Counter>, windowMs: number) {
    if (map.size < MAX_ENTRIES) return;
    const t = now();
    for (const [k, c] of map) {
      if (c.lockedUntil <= t && t - c.windowStart > windowMs) map.delete(k);
    }
  }

  function blockedFor(c: Counter | undefined): number {
    if (!c) return 0;
    const ms = c.lockedUntil - now();
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  }

  /** Suma un fallo; si llega al máximo, bloquea por `lockMs`. */
  function fail(map: Map<string, Counter>, key: string, max: number, windowMs: number, lockMs: number) {
    const t = now();
    let c = map.get(key);
    if (!c || t - c.windowStart > windowMs) {
      c = { failures: 0, windowStart: t, lockedUntil: 0 };
      map.set(key, c);
    }
    c.failures++;
    if (c.failures >= max) {
      c.lockedUntil = t + lockMs;
      c.failures = 0;
      c.windowStart = t;
    }
  }

  return {
    check(ip: string, userKey: string): LimitCheck {
      const wait = Math.max(blockedFor(ips.get(ip)), blockedFor(users.get(userKey)));
      return wait > 0 ? { allowed: false, retryAfterSec: wait } : { allowed: true };
    },

    recordFailure(ip: string, userKey: string) {
      prune(users, opts.userLockMs);
      prune(ips, opts.ipWindowMs);
      // Ventana por usuario = tiempo de bloqueo: fallos espaciados más que eso no acumulan
      fail(users, userKey, opts.maxUserFailures, opts.userLockMs, opts.userLockMs);
      fail(ips, ip, opts.maxIpFailures, opts.ipWindowMs, opts.ipWindowMs);
    },

    /** Login correcto: se olvidan los fallos de ese usuario (no los de la IP). */
    recordSuccess(userKey: string) {
      users.delete(userKey);
    },

    reset() {
      users.clear();
      ips.clear();
    },
  };
}

export const loginLimiter = createLoginLimiter({
  maxUserFailures: 5,
  userLockMs: 10 * 60_000,
  maxIpFailures: 30,
  ipWindowMs: 15 * 60_000,
});

/** Clave por usuario: el mismo nombre en otro restaurante es otra cuenta. */
export function loginUserKey(restaurantId: number, username: string): string {
  return `${restaurantId}:${username.trim().toLowerCase()}`;
}
