// ──────────────────────────────────────────────
// backup.ts — Respaldo nocturno (tarea 6.3)
//
//   npm run respaldo                 lo que corresponda ahora (lo usa la tarea programada, cada hora)
//   npm run respaldo -- --ahora      respaldar ya, sin esperar a la noche
//   npm run respaldo -- --estado     mostrar el estado del último respaldo
//   npm run respaldo -- --probar-aviso   mandar un aviso de prueba (BACKUP_ALERT_URL)
//
// Ver docs/restauracion.md.
// ──────────────────────────────────────────────
import 'dotenv/config';
import { loadBackupConfig } from '../lib/backup/config.js';
import { readState } from '../lib/backup/state.js';
import { runBackup, sendAlert } from '../lib/backup/run.js';

async function main() {
  const cfg = loadBackupConfig();
  const args = process.argv.slice(2);

  if (args.includes('--estado')) {
    console.log(JSON.stringify(await readState(cfg.dir), null, 2));
    return;
  }
  if (args.includes('--probar-aviso')) {
    if (!cfg.alertUrl) throw new Error('No hay BACKUP_ALERT_URL configurada');
    await sendAlert(cfg.alertUrl, `✅ ${cfg.label}: aviso de prueba del respaldo. Si te llegó, está bien configurado.`);
    console.log('Aviso enviado.');
    return;
  }

  if (!cfg.copyDir && !cfg.sftpTarget) {
    console.warn('⚠️  Sin destino externo (BACKUP_COPY_DIR o BACKUP_SFTP_*): el respaldo queda solo en esta PC.');
  }
  const r = await runBackup(cfg, { force: args.includes('--ahora') });
  if (r.skipped) { console.log('Hay otro respaldo en curso: no se hace nada.'); return; }
  if (r.action === 'nothing') { console.log('Nada que hacer: el respaldo de hoy ya está completo, o todavía no es la hora.'); return; }
  for (const f of r.files) console.log(`💾 ${f}`);
  const where: Record<string, string> = { copia: cfg.copyDir ?? 'la carpeta externa', sftp: 'Hostinger (SFTP)' };
  for (const [d, ok] of Object.entries(r.uploaded)) console.log(`${ok ? '✅' : '❌'} copia en ${where[d] ?? d}`);
  if (r.alertSent) console.log('📣 Se envió el aviso de respaldo atrasado.');
  if (!r.ok) {
    console.error(`❌ ${r.error}`);
    process.exitCode = 1;
  } else {
    console.log('✅ Respaldo completo.');
  }
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
