// ──────────────────────────────────────────────
// logger.ts — Registro estructurado (una línea JSON por evento)
//
// - Consola siempre (legible en desarrollo, JSON en producción).
// - Archivo diario en producción (o con LOG_TO_FILE=true):
//     <LOG_DIR>/app-AAAA-MM-DD.log     eventos y errores
//     <LOG_DIR>/access-AAAA-MM-DD.log  pedidos HTTP (morgan, formato combined)
//   El día es el del local (Buenos Aires). Se borran los archivos de más de
//   LOG_RETENTION_DAYS días.
// - Nunca registrar contraseñas ni tokens: las claves sensibles se tapan.
// Sin dependencias nuevas.
// ──────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import { addDays, localDayKey } from './time.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY = /pass(word)?|token|authorization|secret|cookie|imageBase64/i;
const MAX_DEPTH = 5;

/** Copia el valor tapando claves sensibles y convirtiendo errores en objetos planos. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[oculto]' : sanitize(v, depth + 1);
  }
  return out;
}

// ── Archivo diario con retención ──

export interface DailyFileOptions {
  dir: string;
  prefix: string;
  retentionDays: number;
  now?: () => Date;
}

/** Stream que escribe en <dir>/<prefix>-<día local>.log y cambia de archivo al cambiar el día. */
export function createDailyFileStream(opts: DailyFileOptions): Writable & { currentFile(): string } {
  const now = opts.now ?? (() => new Date());
  let day = '';
  let file = '';

  function rotateIfNeeded() {
    const today = localDayKey(now());
    if (today === day) return;
    day = today;
    file = path.join(opts.dir, `${opts.prefix}-${day}.log`);
    fs.mkdirSync(opts.dir, { recursive: true });
    removeOldFiles(opts.dir, opts.prefix, addDays(day, -opts.retentionDays));
  }

  const stream = new Writable({
    write(chunk, _enc, cb) {
      try {
        rotateIfNeeded();
        // appendFileSync: simple y sin perder líneas si el proceso se cae justo después
        fs.appendFileSync(file, chunk);
        cb();
      } catch (err) {
        cb(err as Error);
      }
    },
  });
  // Un error de disco no debe tirar el servidor: se avisa por consola y se sigue
  stream.on('error', (err) => process.stderr.write(`[logger] no se pudo escribir el log: ${err.message}\n`));
  return Object.assign(stream, { currentFile: () => file });
}

/** Borra <prefix>-AAAA-MM-DD.log anteriores a `beforeDay`. */
export function removeOldFiles(dir: string, prefix: string, beforeDay: string) {
  const re = new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})\\.log$`);
  for (const name of fs.readdirSync(dir)) {
    const m = re.exec(name);
    if (m && m[1] < beforeDay) fs.rmSync(path.join(dir, name), { force: true });
  }
}

// ── Logger ──

export interface LogSink { write(line: string): void }

export interface LoggerOptions {
  level: LogLevel;
  pretty: boolean;
  sinks: LogSink[];
}

export function createLogger(opts: LoggerOptions) {
  const sinks = [...opts.sinks];

  function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
    if (LEVELS[level] < LEVELS[opts.level]) return;
    const entry = { time: new Date().toISOString(), level, event, ...(sanitize(fields) as object) };
    const json = JSON.stringify(entry);

    if (opts.pretty) {
      const { time: _t, level: _l, event: _e, ...rest } = entry;
      const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
      (level === 'error' || level === 'warn' ? console.error : console.log)(`[${level}] ${event}${extra}`);
    } else {
      (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(json + '\n');
    }
    for (const sink of sinks) {
      try { sink.write(json + '\n'); } catch { /* el log nunca rompe la operación */ }
    }
  }

  return {
    debug: (event: string, fields?: Record<string, unknown>) => log('debug', event, fields),
    info:  (event: string, fields?: Record<string, unknown>) => log('info', event, fields),
    warn:  (event: string, fields?: Record<string, unknown>) => log('warn', event, fields),
    error: (event: string, fields?: Record<string, unknown>) => log('error', event, fields),
    /** Para tests: sumar un destino extra. */
    addSink: (sink: LogSink) => { sinks.push(sink); return () => { sinks.splice(sinks.indexOf(sink), 1); }; },
  };
}

// ── Instancia de la app ──
// Se configura con variables de entorno leídas acá (no con config/env.ts) para
// que el logger se pueda importar desde cualquier lado sin ciclos.

const isProd = process.env.NODE_ENV === 'production';
const toFile = isProd || process.env.LOG_TO_FILE === 'true';
export const LOG_DIR = path.resolve(process.cwd(), process.env.LOG_DIR || 'logs');
const retentionDays = Number(process.env.LOG_RETENTION_DAYS) > 0 ? Number(process.env.LOG_RETENTION_DAYS) : 30;

/** Pedidos HTTP (morgan) en archivo diario, o null si no se loguea a archivo. */
export const accessLogStream = toFile
  ? createDailyFileStream({ dir: LOG_DIR, prefix: 'access', retentionDays })
  : null;

const appLogStream = toFile
  ? createDailyFileStream({ dir: LOG_DIR, prefix: 'app', retentionDays })
  : null;

export const logger = createLogger({
  level: process.env.NODE_ENV === 'test' ? 'warn' : isProd ? 'info' : 'debug',
  pretty: !isProd,
  sinks: appLogStream ? [{ write: (line) => { appLogStream.write(line); } }] : [],
});
