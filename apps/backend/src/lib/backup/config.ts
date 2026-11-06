// ──────────────────────────────────────────────
// backup/config.ts — Configuración del respaldo nocturno (tarea 6.3)
//
// Todo sale del .env del servidor. Destinos (uno o los dos):
//   - BACKUP_COPY_DIR: otra carpeta (disco externo, o una carpeta de OneDrive /
//     Google Drive que se sincroniza sola a la nube).
//   - BACKUP_SFTP_*: servidor por SFTP (Hostinger), con llave SSH (sin contraseña).
// Sin destino externo igual se respalda en BACKUP_DIR, pero el informe lo avisa:
// un respaldo que vive en la misma PC no sirve si la PC se rompe.
// ──────────────────────────────────────────────
import path from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';

const WINDOWS_MYSQL_BIN = 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin';
const isWindows = process.platform === 'win32';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'falta DATABASE_URL'),
  /** Carpeta local de respaldos (y del estado del respaldo) */
  BACKUP_DIR: z.string().default('respaldos'),
  /** Contraseña de cifrado. Sin ella no se puede restaurar: guardala en un lugar seguro, fuera de esta PC */
  BACKUP_PASSPHRASE: z.string().min(16, 'BACKUP_PASSPHRASE debe tener al menos 16 caracteres'),
  /** Hora local (0–23) desde la que se hace el respaldo del día; antes de esa hora no se intenta */
  BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  /** Carpeta de comprobantes de venta a incluir */
  BACKUP_UPLOADS_DIR: z.string().default('uploads'),
  /** Carpeta con mysqldump y mysql (en Windows, la de MySQL Server 8.0 si existe) */
  MYSQL_BIN_DIR: z.string().optional(),
  TAR_BIN: z.string().optional(),
  SFTP_BIN: z.string().optional(),
  BACKUP_COPY_DIR: z.string().optional(),
  BACKUP_SFTP_HOST: z.string().optional(),
  BACKUP_SFTP_PORT: z.coerce.number().int().positive().default(22),
  BACKUP_SFTP_USER: z.string().optional(),
  /** Llave privada SSH (ruta). Hostinger: hPanel → SSH → agregar la llave pública */
  BACKUP_SFTP_KEY: z.string().optional(),
  /** Carpeta remota (relativa al inicio del usuario), ej. "respaldos-restos" */
  BACKUP_SFTP_DIR: z.string().default('respaldos-restos'),
  /**
   * Aviso si pasan dos noches sin respaldo. Con "{mensaje}" en la URL se hace un GET
   * reemplazándolo (ej. CallMeBot para WhatsApp); si no, un POST con el texto (ej. ntfy.sh).
   */
  BACKUP_ALERT_URL: z.string().url().optional(),
  /** Nombre del local en los avisos */
  BACKUP_LABEL: z.string().default('RestOS'),
});

export interface BackupConfig {
  databaseUrl: string;
  dir: string;
  passphrase: string;
  hour: number;
  retentionDays: number;
  uploadsDir: string;
  mysqldump: string;
  mysql: string;
  tar: string;
  sftp: string;
  copyDir: string | null;
  sftpTarget: { host: string; port: number; user: string; key: string; dir: string } | null;
  alertUrl: string | null;
  label: string;
}

function bin(dir: string | undefined, name: string): string {
  const exe = isWindows ? `${name}.exe` : name;
  if (dir) return path.join(dir, exe);
  if (isWindows && existsSync(path.join(WINDOWS_MYSQL_BIN, exe))) return path.join(WINDOWS_MYSQL_BIN, exe);
  return exe; // en el PATH
}

/** En Windows se usan las herramientas que trae el sistema (no las de Git u otros). */
function systemTool(explicit: string | undefined, windowsPath: string, fallback: string): string {
  if (explicit) return explicit;
  return isWindows && existsSync(windowsPath) ? windowsPath : fallback;
}

export function loadBackupConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): BackupConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msgs = Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => `${k}: ${v?.join(', ')}`);
    throw new Error(`Configuración del respaldo incompleta → ${msgs.join(' · ')}`);
  }
  const e = parsed.data;
  // dotenv convierte "\r" y "\n" entre comillas dobles: "C:\RestOS\respaldos" llega roto
  for (const [k, v] of Object.entries({ BACKUP_DIR: e.BACKUP_DIR, BACKUP_UPLOADS_DIR: e.BACKUP_UPLOADS_DIR, BACKUP_COPY_DIR: e.BACKUP_COPY_DIR, BACKUP_SFTP_KEY: e.BACKUP_SFTP_KEY, MYSQL_BIN_DIR: e.MYSQL_BIN_DIR })) {
    if (v && /[\r\n\t]/.test(v)) {
      throw new Error(`${k} tiene un salto de línea: en el .env escribí las rutas de Windows entre comillas simples ('C:\\...')`);
    }
  }
  const sftpParts = [e.BACKUP_SFTP_HOST, e.BACKUP_SFTP_USER, e.BACKUP_SFTP_KEY];
  if (sftpParts.some(Boolean) && !sftpParts.every(Boolean)) {
    throw new Error('Para subir por SFTP hacen falta BACKUP_SFTP_HOST, BACKUP_SFTP_USER y BACKUP_SFTP_KEY');
  }
  const windir = env.SystemRoot ?? 'C:\\Windows';
  return {
    databaseUrl: e.DATABASE_URL,
    dir: path.resolve(cwd, e.BACKUP_DIR),
    passphrase: e.BACKUP_PASSPHRASE,
    hour: e.BACKUP_HOUR,
    retentionDays: e.BACKUP_RETENTION_DAYS,
    uploadsDir: path.resolve(cwd, e.BACKUP_UPLOADS_DIR),
    mysqldump: bin(e.MYSQL_BIN_DIR, 'mysqldump'),
    mysql: bin(e.MYSQL_BIN_DIR, 'mysql'),
    tar: systemTool(e.TAR_BIN, path.join(windir, 'System32', 'tar.exe'), 'tar'),
    sftp: systemTool(e.SFTP_BIN, path.join(windir, 'System32', 'OpenSSH', 'sftp.exe'), 'sftp'),
    copyDir: e.BACKUP_COPY_DIR ? path.resolve(cwd, e.BACKUP_COPY_DIR) : null,
    sftpTarget: e.BACKUP_SFTP_HOST
      ? { host: e.BACKUP_SFTP_HOST, port: e.BACKUP_SFTP_PORT, user: e.BACKUP_SFTP_USER!, key: path.resolve(cwd, e.BACKUP_SFTP_KEY!), dir: e.BACKUP_SFTP_DIR }
      : null,
    alertUrl: e.BACKUP_ALERT_URL ?? null,
    label: e.BACKUP_LABEL,
  };
}

/** Datos de conexión de DATABASE_URL (para mysqldump / mysql). */
export function parseDatabaseUrl(url: string) {
  const u = new URL(url);
  if (!/^mysql/.test(u.protocol)) throw new Error('DATABASE_URL tiene que ser de MySQL');
  return {
    host: u.hostname || 'localhost',
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}
