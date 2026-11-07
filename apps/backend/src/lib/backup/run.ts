// ──────────────────────────────────────────────
// backup/run.ts — Una corrida del respaldo (tarea 6.3)
//
// La tarea programada lo llama cada hora. Cada corrida:
//   1. decide si toca respaldar, reintentar la subida o nada (state.ts);
//   2. vuelca la base y los comprobantes, comprimidos y cifrados, en BACKUP_DIR;
//   3. copia a los destinos externos (carpeta y/o SFTP); si falla, queda pendiente;
//   4. borra lo que pasó la retención (local y destinos);
//   5. si fallaron dos noches seguidas, avisa (una vez por día).
// Un candado evita que dos corridas se pisen (ej. la hora siguiente llega mientras
// todavía se sube el respaldo anterior).
// ──────────────────────────────────────────────
import { appendFile, mkdir, open, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { BackupConfig } from './config.js';
import { archiveUploads, dumpDatabase } from './dump.js';
import { targetsFor, type Target } from './destinations.js';
import {
  alertMessage, decide, fileDay, filesToDelete, readState, writeState, type Action, type BackupState, type Destination,
} from './state.js';
import { formatLocalDateTime, localDayKey } from '../time.js';

export interface RunResult {
  action: Action;
  ok: boolean;
  files: string[];
  uploaded: Partial<Record<Destination, boolean>>;
  alertSent: boolean;
  error: string | null;
  skipped?: 'locked';
}

const LOCK_STALE_MS = 3 * 3600 * 1000;

async function acquireLock(dir: string): Promise<(() => Promise<void>) | null> {
  const lock = path.join(dir, '.respaldo.lock');
  try {
    const s = await stat(lock);
    if (Date.now() - s.mtimeMs < LOCK_STALE_MS) return null;
    await rm(lock, { force: true }); // candado de una corrida que se cortó
  } catch { /* no hay candado */ }
  try {
    const fh = await open(lock, 'wx');
    await fh.writeFile(`${process.pid} ${new Date().toISOString()}`);
    await fh.close();
    return () => rm(lock, { force: true });
  } catch {
    return null;
  }
}

/** Texto para el aviso (CallMeBot por GET con {mensaje}; ntfy.sh y similares por POST). */
export async function sendAlert(url: string, message: string): Promise<void> {
  const ctrl = AbortSignal.timeout(15_000);
  const res = url.includes('{mensaje}')
    ? await fetch(url.replace('{mensaje}', encodeURIComponent(message)), { signal: ctrl })
    : await fetch(url, { method: 'POST', body: message, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, signal: ctrl });
  if (!res.ok) throw new Error(`el aviso respondió ${res.status}`);
}

export async function runBackup(cfg: BackupConfig, opts: { force?: boolean; now?: Date; targets?: Target[] } = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  await mkdir(cfg.dir, { recursive: true });
  const log = (msg: string) => appendFile(path.join(cfg.dir, `respaldo-${localDayKey(now).slice(0, 7)}.log`), `${formatLocalDateTime(new Date())} ${msg}\n`);
  const release = await acquireLock(cfg.dir);
  const result: RunResult = { action: 'nothing', ok: true, files: [], uploaded: {}, alertSent: false, error: null };
  if (!release) {
    await log('otra corrida en curso: se saltea');
    return { ...result, skipped: 'locked' };
  }

  const targets = opts.targets ?? targetsFor(cfg);
  const destinations = targets.map(t => t.name);
  const state: BackupState = await readState(cfg.dir);
  try {
    state.firstAttemptAt ??= now.toISOString();
    result.action = decide(state, now, cfg.hour, destinations, opts.force);
    if (result.action === 'nothing') return result;
    state.lastAttemptAt = now.toISOString();
    const errors: string[] = [];

    if (result.action === 'dump') {
      const stamp = formatLocalDateTime(now).replace(' ', '_').replace(/:/g, '').slice(0, 15); // 2026-11-06_0300
      const dbFile = path.join(cfg.dir, `restos-db-${stamp}.sql.gz.enc`);
      const upFile = path.join(cfg.dir, `restos-comprobantes-${stamp}.tar.gz.enc`);
      try {
        let bytes = await dumpDatabase(cfg, dbFile);
        const files = [dbFile];
        const upBytes = await archiveUploads(cfg, upFile);
        if (upBytes !== null) { files.push(upFile); bytes += upBytes; }
        result.files = files;
        state.lastLocal = { day: localDayKey(now), at: now.toISOString(), files: files.map(f => path.basename(f)), bytes };
        // El de hoy reemplaza lo pendiente: alcanza con subir el respaldo más nuevo
        for (const d of destinations) state.pending[d] = files.map(f => path.basename(f));
        await log(`respaldo local ok: ${files.map(f => path.basename(f)).join(', ')} (${Math.round(bytes / 1024)} KB)`);
      } catch (err) {
        await rm(dbFile, { force: true });
        await rm(upFile, { force: true });
        throw err;
      }
    }

    // Subir lo pendiente a cada destino (y reintentar la próxima hora si falla)
    for (const t of targets) {
      const pending = (state.pending[t.name] ?? []).filter(n => n);
      if (pending.length === 0) continue;
      try {
        await t.upload(pending.map(n => path.join(cfg.dir, n)));
        const newest = pending.map(fileDay).filter((d): d is string => !!d).sort().at(-1) ?? localDayKey(now);
        state.lastUpload[t.name] = { day: newest, at: new Date().toISOString() };
        state.pending[t.name] = [];
        result.uploaded[t.name] = true;
        await log(`copia en ${t.label} ok`);
        const old = filesToDelete(await t.list(), localDayKey(now), cfg.retentionDays);
        await t.remove(old);
        if (old.length) await log(`${t.label}: borrados ${old.length} respaldos viejos`);
      } catch (err) {
        result.uploaded[t.name] = false;
        errors.push(`${t.label}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Retención local (después de subir: nunca se borra algo que falta subir)
    const stillPending = new Set(Object.values(state.pending).flat());
    const local = (await readdir(cfg.dir)).filter(n => n.startsWith('restos-'));
    const old = filesToDelete(local, localDayKey(now), cfg.retentionDays).filter(n => !stillPending.has(n));
    for (const n of old) await rm(path.join(cfg.dir, n), { force: true });

    if (errors.length) throw new Error(errors.join(' · '));
    state.lastError = null;
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Error ? err.message : String(err);
    state.lastError = { at: now.toISOString(), message: result.error.slice(0, 500) };
    await log(`ERROR: ${result.error}`);
  } finally {
    const msg = cfg.alertUrl ? alertMessage(state, now, cfg.hour, destinations, cfg.label) : null;
    if (msg && cfg.alertUrl) {
      try {
        await sendAlert(cfg.alertUrl, msg);
        state.alertSentDay = localDayKey(now);
        result.alertSent = true;
        await log(`aviso enviado: ${msg}`);
      } catch (err) {
        await log(`no se pudo enviar el aviso: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await writeState(cfg.dir, state);
    await release();
  }
  return result;
}
