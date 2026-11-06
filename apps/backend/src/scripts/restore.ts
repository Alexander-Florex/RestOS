// ──────────────────────────────────────────────
// restore.ts — Restaurar un respaldo (tarea 6.3). Ver docs/restauracion.md.
//
//   npm run restaurar -- --base restos_restaurado --archivo respaldos/restos-db-2026-11-06_0300.sql.gz.enc
//   npm run restaurar -- --comprobantes respaldos/restos-comprobantes-2026-11-06_0300.tar.gz.enc --destino .
//
// Usa el servidor y el usuario de DATABASE_URL, y la contraseña BACKUP_PASSPHRASE.
// Por seguridad restaura en una base NUEVA: no pisa una base con datos salvo --forzar.
// ──────────────────────────────────────────────
import 'dotenv/config';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { loadBackupConfig } from '../lib/backup/config.js';
import { restoreDatabase, restoreUploads } from '../lib/backup/dump.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const cfg = loadBackupConfig();
  const archivo = arg('archivo');
  const base = arg('base');
  const comprobantes = arg('comprobantes');
  if (!archivo && !comprobantes) {
    throw new Error('Indicá --archivo <respaldo de la base> --base <nombre>, y/o --comprobantes <archivo> --destino <carpeta>');
  }
  if (archivo) {
    if (!base) throw new Error('Falta --base <nombre de la base donde restaurar>');
    if (!existsSync(archivo)) throw new Error(`No existe ${archivo}`);
    console.log(`⏳ Restaurando ${path.basename(archivo)} en la base "${base}"...`);
    await restoreDatabase(cfg, archivo, base, { force: process.argv.includes('--forzar') });
    console.log(`✅ Base "${base}" restaurada.`);
  }
  if (comprobantes) {
    const destino = path.resolve(arg('destino') ?? '.');
    if (!existsSync(comprobantes)) throw new Error(`No existe ${comprobantes}`);
    await restoreUploads(cfg, comprobantes, destino);
    console.log(`✅ Comprobantes restaurados en ${path.join(destino, 'uploads')}`);
  }
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
