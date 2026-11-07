// ──────────────────────────────────────────────
// backup/destinations.ts — Dónde se guarda una copia fuera del servidor (tarea 6.3)
//
// - Carpeta (BACKUP_COPY_DIR): disco externo o carpeta de OneDrive/Google Drive.
// - SFTP (Hostinger): con el sftp de Windows, en modo batch y con llave SSH.
// Se sube con nombre ".part" y se renombra al final: si se corta, no queda un
// archivo a medias con nombre de respaldo bueno.
// ──────────────────────────────────────────────
import { copyFile, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { BackupConfig } from './config.js';
import { run } from './tools.js';

export interface Target {
  name: 'copia' | 'sftp';
  label: string;
  upload(files: string[]): Promise<void>;
  list(): Promise<string[]>;
  remove(names: string[]): Promise<void>;
}

export function folderTarget(dir: string): Target {
  return {
    name: 'copia',
    label: `carpeta ${dir}`,
    async upload(files) {
      await mkdir(dir, { recursive: true });
      for (const f of files) {
        const part = path.join(dir, path.basename(f) + '.part');
        await copyFile(f, part);
        await rename(part, path.join(dir, path.basename(f)));
      }
    },
    async list() {
      try { return (await readdir(dir)).filter(n => !n.endsWith('.part')); } catch { return []; }
    },
    async remove(names) {
      for (const n of names) await rm(path.join(dir, n), { force: true });
    },
  };
}

/** Comillas para rutas en el batch de sftp. */
function q(p: string): string {
  return `"${p.replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
}

/** Comandos sftp para subir: crea la carpeta (si existe, el "-" ignora el error) y renombra al final. */
export function sftpUploadScript(dir: string, files: string[]): string {
  const lines = [`-mkdir ${q(dir)}`, `cd ${q(dir)}`];
  for (const f of files) {
    const name = f.split(/[\\/]/).pop() ?? f;   // vale para rutas de Windows aunque corra en Linux
    lines.push(`-rm ${q(name + '.part')}`, `put ${q(f)} ${q(name + '.part')}`, `-rm ${q(name)}`, `rename ${q(name + '.part')} ${q(name)}`);
  }
  return lines.join('\n') + '\n';
}

/** Nombres de la salida de "ls -1" (sin rutas ni ruido). */
export function parseSftpList(out: string): string[] {
  return out.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('sftp>'))
    .map(l => l.split('/').pop()!)
    .filter(n => n.startsWith('restos-') && !n.endsWith('.part'));
}

export function sftpTarget(cfg: BackupConfig): Target {
  const t = cfg.sftpTarget!;
  const args = [
    '-b', '-', '-P', String(t.port), '-i', t.key,
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=30',
    `${t.user}@${t.host}`,
  ];
  const sftp = (script: string) => run(cfg.sftp, args, 'sftp', script);
  return {
    name: 'sftp',
    label: `SFTP ${t.user}@${t.host}:${t.dir}`,
    async upload(files) { await sftp(sftpUploadScript(t.dir, files)); },
    async list() { return parseSftpList(await sftp(`-mkdir ${q(t.dir)}\nls -1 ${q(t.dir)}\n`)); },
    async remove(names) {
      if (names.length === 0) return;
      await sftp(names.map(n => `-rm ${q(`${t.dir}/${n}`)}`).join('\n') + '\n');
    },
  };
}

export function targetsFor(cfg: BackupConfig): Target[] {
  return [
    ...(cfg.copyDir ? [folderTarget(cfg.copyDir)] : []),
    ...(cfg.sftpTarget ? [sftpTarget(cfg)] : []),
  ];
}
