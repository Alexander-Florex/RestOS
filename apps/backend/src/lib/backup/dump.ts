// ──────────────────────────────────────────────
// backup/dump.ts — Volcado y restauración de la base y los comprobantes (tarea 6.3)
// ──────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { BackupConfig } from './config.js';
import { decryptFile, encryptFile, encryptStream } from './crypto.js';
import { run, waitExit, withMysqlOptions } from './tools.js';

/** Se queda con el final del volcado para confirmar que mysqldump terminó entero. */
function tail(keep: number) {
  let last = Buffer.alloc(0);
  const t = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      last = Buffer.concat([last, chunk]).subarray(-keep);
      cb(null, chunk);
    },
  });
  return { stream: t, text: () => last.toString('utf8') };
}

/** Vuelca la base de DATABASE_URL, comprimida y cifrada, en `dest`. Devuelve el tamaño. */
export async function dumpDatabase(cfg: BackupConfig, dest: string): Promise<number> {
  await withMysqlOptions(cfg.databaseUrl, async (options, database) => {
    const child = spawn(cfg.mysqldump, [
      `--defaults-extra-file=${options}`,
      '--single-transaction', '--quick', '--triggers',
      '--no-tablespaces', '--hex-blob', '--default-character-set=utf8mb4',
      database,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const end = tail(256);
    const exited = waitExit(child, 'mysqldump');
    await Promise.all([
      encryptStream(child.stdout!.pipe(end.stream).pipe(createGzip({ level: 6 })), dest, cfg.passphrase),
      exited,
    ]);
    if (!/Dump completed/.test(end.text())) throw new Error('El volcado de la base quedó incompleto');
  });
  return (await stat(dest)).size;
}

/** Empaqueta la carpeta de comprobantes (tar.gz) y la cifra. null si no hay comprobantes. */
export async function archiveUploads(cfg: BackupConfig, dest: string): Promise<number | null> {
  if (!existsSync(cfg.uploadsDir) || (await readdir(cfg.uploadsDir)).length === 0) return null;
  const work = await mkdtemp(path.join(tmpdir(), 'restos-uploads-'));
  try {
    const tarFile = path.join(work, 'comprobantes.tar.gz');
    await run(cfg.tar, ['-czf', tarFile, '-C', path.dirname(cfg.uploadsDir), path.basename(cfg.uploadsDir)], 'tar');
    await encryptFile(tarFile, dest, cfg.passphrase);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return (await stat(dest)).size;
}

const SAFE_DB_NAME = /^[A-Za-z0-9_]{1,64}$/;

/** Cantidad de tablas de una base (0 si no existe). */
async function tableCount(cfg: BackupConfig, options: string, database: string): Promise<number> {
  const out = await run(cfg.mysql, [
    `--defaults-extra-file=${options}`, '-N', '-B', '-e',
    `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${database}'`,
  ], 'mysql');
  return Number(out.trim() || 0);
}

/**
 * Restaura un volcado en la base `targetDb` (del mismo servidor de DATABASE_URL).
 * Primero descifra a un archivo temporal: si la contraseña está mal o el archivo
 * dañado, falla ANTES de tocar la base. Se niega a pisar una base con tablas
 * salvo `force`.
 */
export async function restoreDatabase(cfg: BackupConfig, file: string, targetDb: string, opts: { force?: boolean } = {}) {
  if (!SAFE_DB_NAME.test(targetDb)) throw new Error(`Nombre de base inválido: "${targetDb}" (solo letras, números y _)`);
  const work = await mkdtemp(path.join(tmpdir(), 'restos-restore-'));
  try {
    const plain = path.join(work, 'volcado.sql.gz');
    await decryptFile(file, plain, cfg.passphrase);
    await withMysqlOptions(cfg.databaseUrl, async (options) => {
      const tables = await tableCount(cfg, options, targetDb);
      if (tables > 0 && !opts.force) {
        throw new Error(`La base "${targetDb}" ya tiene ${tables} tablas. Restaurá en una base nueva, o usá --forzar si de verdad querés pisarla`);
      }
      if (tables > 0) {
        await run(cfg.mysql, [`--defaults-extra-file=${options}`, '-e', `DROP DATABASE \`${targetDb}\``], 'mysql');
      }
      await run(cfg.mysql, [`--defaults-extra-file=${options}`, '-e',
        `CREATE DATABASE IF NOT EXISTS \`${targetDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`], 'mysql');
      const child = spawn(cfg.mysql, [`--defaults-extra-file=${options}`, '--default-character-set=utf8mb4', targetDb],
        { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
      const exited = waitExit(child, 'mysql');
      await Promise.all([pipeline(createReadStream(plain), createGunzip(), child.stdin!), exited]);
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Restaura los comprobantes dentro de `destParent` (queda destParent/uploads). */
export async function restoreUploads(cfg: BackupConfig, file: string, destParent: string) {
  const work = await mkdtemp(path.join(tmpdir(), 'restos-restore-'));
  try {
    const tarFile = path.join(work, 'comprobantes.tar.gz');
    await decryptFile(file, tarFile, cfg.passphrase);
    await run(cfg.tar, ['-xzf', tarFile, '-C', destParent], 'tar');
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

