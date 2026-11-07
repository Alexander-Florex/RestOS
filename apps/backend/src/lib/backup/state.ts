// ──────────────────────────────────────────────
// backup/state.ts — Estado del respaldo y decisiones (tarea 6.3)
//
// La tarea de Windows corre el respaldo cada hora. Acá se decide qué hacer:
//   - antes de BACKUP_HOUR, o si el respaldo de hoy ya está completo: nada;
//   - si falta el de hoy: hacerlo;
//   - si está hecho pero algún destino falló (ej. sin internet): reintentar solo la subida.
// El estado queda en BACKUP_DIR/estado.json; el backend lo lee para mostrarlo.
// Funciones puras salvo leer/guardar el archivo.
// ──────────────────────────────────────────────
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { formatLocalDateTime, localDayKey, addDays } from '../time.js';

export type Destination = 'copia' | 'sftp';

export interface BackupState {
  /** Primer intento de todos (para avisar si nunca se completó) */
  firstAttemptAt: string | null;
  /** Último intento (cualquier resultado) */
  lastAttemptAt: string | null;
  /** Último respaldo local completo (día local y archivos) */
  lastLocal: { day: string; at: string; files: string[]; bytes: number } | null;
  /** Por destino: último envío correcto */
  lastUpload: Partial<Record<Destination, { day: string; at: string }>>;
  /** Archivos que faltan subir, por destino (se reintentan cada hora) */
  pending: Partial<Record<Destination, string[]>>;
  lastError: { at: string; message: string } | null;
  /** Día local en que se mandó el último aviso (uno por día como máximo) */
  alertSentDay: string | null;
}

export const EMPTY_STATE: BackupState = {
  firstAttemptAt: null, lastAttemptAt: null, lastLocal: null, lastUpload: {}, pending: {}, lastError: null, alertSentDay: null,
};

export function statePath(dir: string) {
  return path.join(dir, 'estado.json');
}

export async function readState(dir: string): Promise<BackupState> {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(await readFile(statePath(dir), 'utf8')) };
  } catch {
    return { ...EMPTY_STATE };
  }
}

/** Escritura atómica: si se corta la luz justo acá, queda el estado anterior entero. */
export async function writeState(dir: string, state: BackupState): Promise<void> {
  const tmp = statePath(dir) + '.tmp';
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await rename(tmp, statePath(dir));
}

export function localHour(now: Date): number {
  return Number(formatLocalDateTime(now).slice(11, 13));
}

export type Action = 'dump' | 'upload' | 'nothing';

/** Qué hacer en esta corrida. `force` = respaldar ya (comando manual). */
export function decide(state: BackupState, now: Date, hour: number, destinations: Destination[], force = false): Action {
  if (force) return 'dump';
  const today = localDayKey(now);
  const pending = destinations.some(d => (state.pending[d]?.length ?? 0) > 0);
  if (state.lastLocal?.day === today) return pending ? 'upload' : 'nothing';
  if (localHour(now) < hour) return pending ? 'upload' : 'nothing';
  return 'dump';
}

/** Archivos de respaldo: "restos-db-2026-11-06_0300.sql.gz.enc" → día "2026-11-06". */
export function fileDay(name: string): string | null {
  const m = name.match(/^restos-(?:db|comprobantes)-(\d{4}-\d{2}-\d{2})_\d{4}\./);
  return m ? m[1] : null;
}

/**
 * Qué archivos borrar: los de días anteriores a la retención. Siempre se conservan
 * los respaldos de los últimos 7 días que haya, aunque sean viejos (si la PC estuvo
 * apagada un mes, no se borra todo de golpe).
 */
export function filesToDelete(names: string[], today: string, retentionDays: number): string[] {
  const dated = names.map(n => ({ n, day: fileDay(n) })).filter((x): x is { n: string; day: string } => x.day !== null);
  const days = [...new Set(dated.map(x => x.day))].sort().reverse();
  const keep = new Set(days.slice(0, 7));
  const limit = addDays(today, -retentionDays);
  return dated.filter(x => x.day < limit && !keep.has(x.day)).map(x => x.n);
}

/**
 * ¿Hay que avisar? Si fallaron dos noches seguidas: el último respaldo completo (local
 * y externo) es anterior a la noche pasada. Antes de BACKUP_HOUR, "hoy" todavía no tocaba.
 */
export function alertMessage(state: BackupState, now: Date, hour: number, destinations: Destination[], label: string): string | null {
  const today = localDayKey(now);
  const expected = localHour(now) >= hour ? today : addDays(today, -1);
  if (state.alertSentDay === today) return null;
  // Último día con respaldo completo: el local y todos los destinos externos
  const days = [state.lastLocal?.day ?? null, ...destinations.map(d => state.lastUpload[d]?.day ?? null)];
  if (days.includes(null)) {
    // Nunca se completó: avisar recién cuando ya pasaron dos noches desde el primer intento
    if (!state.firstAttemptAt || localDayKey(new Date(state.firstAttemptAt)) > addDays(expected, -1)) return null;
    return `⚠️ ${label}: el respaldo nocturno nunca se completó. ${state.lastError ? `Último error: ${state.lastError.message}` : ''}`.trim();
  }
  const lastComplete = (days as string[]).sort()[0];
  if (lastComplete >= addDays(expected, -1)) return null;
  return `⚠️ ${label}: hace ${dayDiff(lastComplete, today)} días que no se completa el respaldo nocturno (último: ${lastComplete}). ${state.lastError ? `Error: ${state.lastError.message}` : ''}`.trim();
}

function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
