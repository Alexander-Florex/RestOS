// ──────────────────────────────────────────────
// backup/tools.ts — Programas externos del respaldo (tarea 6.3)
// mysqldump / mysql (vienen con MySQL Server), tar y sftp (vienen con Windows 10/11).
// ──────────────────────────────────────────────
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDatabaseUrl } from './config.js';

/** Espera a que termine el proceso; si sale con error, lanza con lo que dijo por stderr. */
export function waitExit(child: ChildProcess, label: string): Promise<string> {
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
  return new Promise((resolve, reject) => {
    child.on('error', (err: NodeJS.ErrnoException) => {
      reject(new Error(err.code === 'ENOENT'
        ? `No se encontró ${label}. Revisá que esté instalado (o configurá su carpeta en el .env)`
        : `${label}: ${err.message}`));
    });
    child.on('close', (code) => {
      // MySQL avisa siempre que la contraseña en un archivo es insegura: no es un error
      const msg = stderr.split(/\r?\n/).filter(l => l.trim() && !/Using a password|\[Warning\]/i.test(l)).join(' ').trim();
      if (code === 0) resolve(msg);
      else reject(new Error(`${label} terminó con error (${code})${msg ? `: ${msg.slice(0, 500)}` : ''}`));
    });
  });
}

/** Corre un programa y devuelve su salida estándar. */
export async function run(cmd: string, args: string[], label: string, input?: string): Promise<string> {
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout!.on('data', (d: Buffer) => { out += d.toString(); });
  if (input !== undefined) child.stdin!.end(input); else child.stdin!.end();
  await waitExit(child, label);
  return out;
}

function optionValue(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Archivo temporal de opciones de MySQL con usuario y contraseña. Se borra al terminar.
 * Así la contraseña no aparece en la lista de procesos.
 */
export async function withMysqlOptions<T>(databaseUrl: string, fn: (optionsFile: string, database: string) => Promise<T>): Promise<T> {
  const db = parseDatabaseUrl(databaseUrl);
  const dir = await mkdtemp(path.join(tmpdir(), 'restos-mysql-'));
  const file = path.join(dir, 'cliente.cnf');
  await writeFile(file, [
    '[client]',
    `user=${optionValue(db.user)}`,
    `password=${optionValue(db.password)}`,
    `host=${optionValue(db.host)}`,
    `port=${db.port}`,
    '',
  ].join('\n'), { mode: 0o600 });
  try {
    return await fn(file, db.database);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
