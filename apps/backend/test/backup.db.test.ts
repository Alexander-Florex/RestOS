// ──────────────────────────────────────────────
// backup.db.test.ts — Respaldo y restauración de verdad (tarea 6.3):
// mysqldump de la base de prueba → cifrado → restaurado en otra base →
// mismos datos. Más la corrida completa con un destino que falla y se reintenta.
// Necesita mysqldump y mysql (MySQL Server). Si no están, se saltea.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { loadBackupConfig, type BackupConfig } from '../src/lib/backup/config.js';
import { dumpDatabase, archiveUploads, restoreDatabase, restoreUploads } from '../src/lib/backup/dump.js';
import { runBackup } from '../src/lib/backup/run.js';
import { folderTarget, type Target } from '../src/lib/backup/destinations.js';
import { readState } from '../src/lib/backup/state.js';

const RESTORE_DB = 'restos_restore_test';
const work = mkdtempSync(path.join(tmpdir(), 'restos-backup-'));
const uploads = path.join(work, 'uploads');
const cfg: BackupConfig = loadBackupConfig({
  ...process.env,
  BACKUP_PASSPHRASE: 'contraseña-de-prueba-del-respaldo',
  BACKUP_DIR: path.join(work, 'respaldos'),
  BACKUP_UPLOADS_DIR: uploads,
}, work);
const hasMysql = spawnSync(cfg.mysqldump, ['--version']).status === 0;
const skip = hasMysql ? false : 'mysqldump no está instalado en esta máquina';

const restoredUrl = () => {
  const u = new URL(process.env.DATABASE_URL!);
  u.pathname = `/${RESTORE_DB}`;
  return u.toString();
};
async function dropRestored() {
  await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${RESTORE_DB}\``);
}

before(async () => {
  await prisma.recipeIngredient.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.restaurant.deleteMany();
  // Datos con tildes, comillas y decimales para comprobar que vuelven iguales
  const r = await prisma.restaurant.create({ data: { name: "Lo de Ñandú 'el bueno'" } });
  await prisma.inventoryItem.create({ data: { restaurantId: r.id, name: 'Azúcar "impalpable"', category: 'FOOD', quantity: 12.75, unit: 'kg', costPerUnit: '1234.5678' } });
  await prisma.storageArea.create({ data: { restaurantId: r.id, name: 'Cámara / heladera' } });
  mkdirSync(path.join(uploads, 'sales'), { recursive: true });
  writeFileSync(path.join(uploads, 'sales', 'comprobante-1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  await dropRestored();
});
after(async () => {
  await dropRestored();
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  rmSync(work, { recursive: true, force: true });
});

test('se vuelca, se cifra y se restaura en otra base con los mismos datos', { skip }, async () => {
  mkdirSync(cfg.dir, { recursive: true });
  const file = path.join(cfg.dir, 'restos-db-2026-11-06_0300.sql.gz.enc');
  const size = await dumpDatabase(cfg, file);
  assert.ok(size > 1000);
  assert.ok(!readFileSync(file).includes(Buffer.from('CREATE TABLE')), 'el respaldo está cifrado');

  await restoreDatabase(cfg, file, RESTORE_DB);
  const restored = new PrismaClient({ datasources: { db: { url: restoredUrl() } } });
  try {
    const item = await restored.inventoryItem.findFirstOrThrow();
    assert.equal(item.name, 'Azúcar "impalpable"');
    assert.equal(item.quantity, 12.75);
    assert.equal(String(item.costPerUnit), '1234.5678');
    assert.equal((await restored.restaurant.findFirstOrThrow()).name, "Lo de Ñandú 'el bueno'");
    // Las migraciones quedan registradas: la base restaurada se puede seguir actualizando
    const migs = await restored.$queryRawUnsafe<{ n: bigint }[]>('SELECT COUNT(*) AS n FROM _prisma_migrations');
    const orig = await prisma.$queryRawUnsafe<{ n: bigint }[]>('SELECT COUNT(*) AS n FROM _prisma_migrations');
    assert.equal(Number(migs[0].n), Number(orig[0].n));
    // Mismas tablas con la misma cantidad de filas
    for (const t of ['restaurants', 'inventory_items', 'storage_areas', 'roles', 'users']) {
      const a = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM \`${t}\``);
      const b = await restored.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM \`${t}\``);
      assert.equal(Number(b[0].n), Number(a[0].n), t);
    }
  } finally {
    await restored.$disconnect();
  }

  // No pisa una base con datos sin --forzar; con contraseña equivocada no toca nada
  await assert.rejects(restoreDatabase(cfg, file, RESTORE_DB), /ya tiene \d+ tablas/);
  await assert.rejects(restoreDatabase({ ...cfg, passphrase: 'otra-contraseña-equivocada' }, file, RESTORE_DB, { force: true }), /contraseña/);
  await assert.rejects(restoreDatabase(cfg, file, 'mala; DROP DATABASE x'), /Nombre de base inválido/);
  await restoreDatabase(cfg, file, RESTORE_DB, { force: true });
});

test('los comprobantes se empaquetan, se cifran y vuelven iguales', { skip }, async () => {
  const file = path.join(cfg.dir, 'restos-comprobantes-2026-11-06_0300.tar.gz.enc');
  assert.ok((await archiveUploads(cfg, file))! > 0);
  const dest = mkdtempSync(path.join(work, 'restaurado-'));
  await restoreUploads(cfg, file, dest);
  assert.deepEqual([...readFileSync(path.join(dest, 'uploads', 'sales', 'comprobante-1.jpg'))], [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
});

test('corrida completa: copia afuera; si el destino falla, queda pendiente y se reintenta la hora siguiente', { skip }, async () => {
  const dir = path.join(work, 'corrida');
  const c = { ...cfg, dir };
  const outside = path.join(work, 'onedrive');
  let failing = true;
  const flaky: Target = {
    ...folderTarget(path.join(work, 'hostinger')),
    name: 'sftp', label: 'hostinger de prueba',
    async upload(files) {
      if (failing) throw new Error('sin internet');
      return folderTarget(path.join(work, 'hostinger')).upload(files);
    },
  };
  const targets = [folderTarget(outside), flaky];
  const at = (hh: number) => new Date(`2026-11-06T${String(hh).padStart(2, '0')}:05:00-03:00`);

  assert.equal((await runBackup(c, { now: at(2), targets })).action, 'nothing'); // antes de las 3

  const first = await runBackup(c, { now: at(3), targets });
  assert.equal(first.action, 'dump');
  assert.equal(first.ok, false);
  assert.equal(first.files.length, 2);
  assert.deepEqual(first.uploaded, { copia: true, sftp: false });
  assert.equal(readdirSync(outside).filter(n => n.startsWith('restos-')).length, 2);
  let state = await readState(dir);
  assert.equal(state.pending.sftp?.length, 2);
  assert.match(state.lastError?.message ?? '', /sin internet/);

  failing = false;
  const retry = await runBackup(c, { now: at(4), targets });
  assert.equal(retry.action, 'upload');
  assert.equal(retry.ok, true);
  assert.equal(readdirSync(path.join(work, 'hostinger')).length, 2);
  state = await readState(dir);
  assert.deepEqual(state.pending.sftp, []);
  assert.equal(state.lastUpload.sftp?.day, '2026-11-06');
  assert.equal(state.lastError, null);

  assert.equal((await runBackup(c, { now: at(5), targets })).action, 'nothing'); // ya está el de hoy
  assert.ok(existsSync(path.join(dir, 'respaldo-2026-11.log')));
});
