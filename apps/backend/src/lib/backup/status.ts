// ──────────────────────────────────────────────
// backup/status.ts — Estado del respaldo para mostrar en el panel (tarea 6.3)
// Lo lee el backend (no necesita la contraseña de cifrado).
// ──────────────────────────────────────────────
import path from 'node:path';
import { addDays, localDayKey } from '../time.js';
import { localHour, readState, type BackupState, type Destination } from './state.js';

export type BackupHealth =
  | 'ok'            // anoche (o hoy) se respaldó y se copió afuera
  | 'solo-local'    // se respalda, pero no hay copia fuera de esta PC
  | 'atrasado'      // falló una noche
  | 'falla'         // fallaron dos noches o más
  | 'nunca'         // está configurado pero todavía no se completó ninguno
  | 'sin-configurar';

export interface BackupStatus {
  health: BackupHealth;
  destinations: Destination[];
  /** Último día con respaldo completo (local y todos los destinos) */
  lastCompleteDay: string | null;
  lastLocalAt: string | null;
  lastError: string | null;
  pending: number;
}

export function computeStatus(state: BackupState, now: Date, hour: number, destinations: Destination[], configured: boolean): BackupStatus {
  const base = {
    destinations,
    lastLocalAt: state.lastLocal?.at ?? null,
    lastError: state.lastError?.message ?? null,
    pending: Object.values(state.pending).reduce((n, list) => n + (list?.length ?? 0), 0),
  };
  if (!configured) return { ...base, health: 'sin-configurar', lastCompleteDay: null };
  if (!state.lastLocal) return { ...base, health: 'nunca', lastCompleteDay: null };

  const days = [state.lastLocal.day, ...destinations.map(d => state.lastUpload[d]?.day ?? null)];
  const lastCompleteDay = days.includes(null) ? null : (days as string[]).sort()[0];
  const today = localDayKey(now);
  const expected = localHour(now) >= hour ? today : addDays(today, -1);
  const reference = lastCompleteDay ?? state.lastLocal.day;
  let health: BackupHealth;
  if (reference >= expected) health = destinations.length === 0 ? 'solo-local' : lastCompleteDay ? 'ok' : 'atrasado';
  else if (reference >= addDays(expected, -1)) health = 'atrasado';
  else health = 'falla';
  return { ...base, health, lastCompleteDay };
}

/** Estado según el .env del servidor (BACKUP_DIR, BACKUP_HOUR, destinos). */
export async function backupStatus(env: NodeJS.ProcessEnv = process.env, now = new Date()): Promise<BackupStatus> {
  const dir = path.resolve(process.cwd(), env.BACKUP_DIR || 'respaldos');
  const destinations: Destination[] = [
    ...(env.BACKUP_COPY_DIR ? ['copia' as const] : []),
    ...(env.BACKUP_SFTP_HOST ? ['sftp' as const] : []),
  ];
  const hour = Number(env.BACKUP_HOUR ?? 3);
  return computeStatus(await readState(dir), now, Number.isFinite(hour) ? hour : 3, destinations, Boolean(env.BACKUP_PASSPHRASE));
}
