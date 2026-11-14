// ──────────────────────────────────────────────
// backup.test.ts — Respaldo nocturno (tarea 6.3), sin base: cifrado, cuándo
// respaldar, retención, avisos y comandos de SFTP.
// ──────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decryptFile, encryptFile } from '../src/lib/backup/crypto.js';
import { alertMessage, decide, EMPTY_STATE, filesToDelete, type BackupState } from '../src/lib/backup/state.js';
import { parseSftpList, sftpUploadScript } from '../src/lib/backup/destinations.js';
import { loadBackupConfig, parseDatabaseUrl } from '../src/lib/backup/config.js';

const PASS = 'una-contraseña-larga-de-prueba';
/** Instante para una hora local de Buenos Aires (UTC−3). */
const at = (day: string, hh: number) => new Date(`${day}T${String(hh).padStart(2, '0')}:00:00-03:00`);
const st = (s: Partial<BackupState>): BackupState => ({ ...EMPTY_STATE, lastUpload: {}, pending: {}, ...s });

test('cifrado: ida y vuelta; contraseña equivocada o archivo tocado fallan', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'restos-crypto-'));
  try {
    const plain = path.join(dir, 'a.txt');
    const enc = path.join(dir, 'a.enc');
    const back = path.join(dir, 'b.txt');
    const content = 'INSERT INTO ventas VALUES (1, 12500.50);\n'.repeat(5000);
    writeFileSync(plain, content);
    await encryptFile(plain, enc, PASS);
    assert.ok(!readFileSync(enc).includes(Buffer.from('INSERT INTO')), 'el archivo cifrado no deja ver el contenido');
    await decryptFile(enc, back, PASS);
    assert.equal(readFileSync(back, 'utf8'), content);

    await assert.rejects(decryptFile(enc, back, 'otra-contraseña-cualquiera'), /contraseña|dañado/);
    const bytes = readFileSync(enc);
    bytes[200] ^= 0xff;
    writeFileSync(enc, bytes);
    await assert.rejects(decryptFile(enc, back, PASS), /contraseña|dañado/);
    writeFileSync(enc, 'cualquier cosa que no es un respaldo de restos');
    await assert.rejects(decryptFile(enc, back, PASS), /No es un respaldo|incompleto/);
  } finally {
    // Un descifrado rechazado puede terminar de cerrar su archivo un instante después:
    // se reintenta el borrado (en Linux daba ENOTEMPTY de vez en cuando)
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('cuándo respaldar: desde la hora configurada, una vez por día; si falla la subida, reintenta solo eso', () => {
  const dest = ['sftp'] as const;
  assert.equal(decide(st({}), at('2026-11-06', 2), 3, [...dest]), 'nothing');
  assert.equal(decide(st({}), at('2026-11-06', 3), 3, [...dest]), 'dump');
  // La PC estuvo apagada a las 3: se hace apenas prende
  assert.equal(decide(st({}), at('2026-11-06', 15), 3, [...dest]), 'dump');
  const done = st({ lastLocal: { day: '2026-11-06', at: '', files: [], bytes: 0 } });
  assert.equal(decide(done, at('2026-11-06', 4), 3, [...dest]), 'nothing');
  assert.equal(decide({ ...done, pending: { sftp: ['restos-db-2026-11-06_0300.sql.gz.enc'] } }, at('2026-11-06', 4), 3, [...dest]), 'upload');
  // Antes de la hora, igual se reintenta lo pendiente de ayer
  assert.equal(decide(st({ pending: { sftp: ['x'] } }), at('2026-11-07', 1), 3, [...dest]), 'upload');
  assert.equal(decide(done, at('2026-11-06', 4), 3, [...dest], true), 'dump');
});

test('retención: borra lo de más de 30 días, pero siempre deja los últimos 7 respaldos', () => {
  const names = [
    'restos-db-2026-09-01_0300.sql.gz.enc', 'restos-comprobantes-2026-09-01_0300.tar.gz.enc',
    'restos-db-2026-10-06_0300.sql.gz.enc', 'restos-db-2026-10-07_0300.sql.gz.enc',
    'estado.json', 'respaldo-2026-11.log',
    ...['01', '02', '03', '04', '05', '06'].map(d => `restos-db-2026-11-${d}_0300.sql.gz.enc`),
  ];
  // 6/10 tiene 31 días: se borra; 7/10 tiene 30: queda
  assert.deepEqual(filesToDelete(names, '2026-11-06', 30).sort(), [
    'restos-comprobantes-2026-09-01_0300.tar.gz.enc', 'restos-db-2026-09-01_0300.sql.gz.enc',
    'restos-db-2026-10-06_0300.sql.gz.enc',
  ]);
  // PC apagada dos meses: no se borra todo de golpe
  const viejos = ['01', '02', '03'].map(d => `restos-db-2026-08-${d}_0300.sql.gz.enc`);
  assert.deepEqual(filesToDelete(viejos, '2026-11-06', 30), []);
});

test('aviso: recién cuando fallan dos noches seguidas, y una vez por día', () => {
  const ok = (day: string) => st({
    firstAttemptAt: at('2026-10-01', 3).toISOString(),
    lastLocal: { day, at: '', files: [], bytes: 0 }, lastUpload: { sftp: { day, at: '' } },
  });
  // Respaldo de anoche bien: nada
  assert.equal(alertMessage(ok('2026-11-06'), at('2026-11-06', 10), 3, ['sftp'], 'Resto'), null);
  // Falló una noche (hoy 6, último bueno el 5): todavía no
  assert.equal(alertMessage(ok('2026-11-05'), at('2026-11-06', 10), 3, ['sftp'], 'Resto'), null);
  // Falló el 6 y el 7: avisa
  assert.match(alertMessage(ok('2026-11-05'), at('2026-11-07', 10), 3, ['sftp'], 'Resto') ?? '', /2 días/);
  // A la 1 de la mañana del 7, el respaldo del 7 todavía no tocaba: no avisa
  assert.equal(alertMessage(ok('2026-11-05'), at('2026-11-07', 1), 3, ['sftp'], 'Resto'), null);
  // Local bien pero la subida lleva dos noches sin andar: avisa
  const sinSubir = { ...ok('2026-11-07'), lastUpload: { sftp: { day: '2026-11-05', at: '' } } };
  assert.ok(alertMessage(sinSubir, at('2026-11-07', 10), 3, ['sftp'], 'Resto'));
  // Ya avisó hoy
  assert.equal(alertMessage({ ...ok('2026-11-05'), alertSentDay: '2026-11-07' }, at('2026-11-07', 10), 3, ['sftp'], 'Resto'), null);
  // Nunca funcionó, instalado ayer: todavía no; instalado anteayer: sí
  const nunca = (first: string) => st({ firstAttemptAt: at(first, 3).toISOString(), lastError: { at: '', message: 'sin internet' } });
  assert.equal(alertMessage(nunca('2026-11-07'), at('2026-11-07', 10), 3, ['sftp'], 'Resto'), null);
  assert.match(alertMessage(nunca('2026-11-06'), at('2026-11-07', 10), 3, ['sftp'], 'Resto') ?? '', /nunca se completó.*sin internet/);
});

test('SFTP: sube con nombre provisorio y renombra; lee el listado', () => {
  const script = sftpUploadScript('respaldos-restos', ['C:\\RestOS\\respaldos\\restos-db-2026-11-06_0300.sql.gz.enc']);
  assert.match(script, /^-mkdir "respaldos-restos"\ncd "respaldos-restos"\n/);
  assert.match(script, /put "C:\/RestOS\/respaldos\/restos-db-2026-11-06_0300.sql.gz.enc" "restos-db-2026-11-06_0300.sql.gz.enc.part"/);
  assert.match(script, /rename "restos-db-2026-11-06_0300.sql.gz.enc.part" "restos-db-2026-11-06_0300.sql.gz.enc"/);
  const listed = parseSftpList('sftp> ls -1 "respaldos-restos"\nrespaldos-restos/restos-db-2026-11-05_0300.sql.gz.enc\nrespaldos-restos/restos-db-2026-11-06_0300.sql.gz.enc.part\notro.txt\n');
  assert.deepEqual(listed, ['restos-db-2026-11-05_0300.sql.gz.enc']);
});

test('configuración: valida contraseña y SFTP completo; la contraseña de MySQL se lee bien', () => {
  const base = { DATABASE_URL: 'mysql://root:p%40ss@localhost:3306/restos_db', BACKUP_PASSPHRASE: PASS };
  assert.throws(() => loadBackupConfig({ ...base, BACKUP_PASSPHRASE: 'corta' }), /BACKUP_PASSPHRASE/);
  assert.throws(() => loadBackupConfig({ ...base, BACKUP_SFTP_HOST: 'x.hostinger.com' }), /BACKUP_SFTP_USER/);
  // "C:\RestOS\respaldos" entre comillas dobles llega con un salto de línea en "\r"
  assert.throws(() => loadBackupConfig({ ...base, BACKUP_DIR: 'C:\\RestOS\respaldos' }), /comillas simples/);
  const cfg = loadBackupConfig({ ...base, BACKUP_COPY_DIR: 'D:\\Respaldos' }, 'C:\\RestOS\\apps\\backend');
  assert.equal(cfg.hour, 3);
  assert.equal(cfg.retentionDays, 30);
  assert.equal(cfg.sftpTarget, null);
  assert.deepEqual(parseDatabaseUrl(base.DATABASE_URL), { host: 'localhost', port: 3306, user: 'root', password: 'p@ss', database: 'restos_db' });
});

test('estado para el panel: ok, solo local, atrasado, falla, nunca, sin configurar', async () => {
  const { computeStatus } = await import('../src/lib/backup/status.js');
  const done = (local: string, up: string | null) => st({
    lastLocal: { day: local, at: '', files: [], bytes: 0 },
    lastUpload: up ? { sftp: { day: up, at: '' } } : {},
  });
  const now = at('2026-11-07', 10);
  assert.equal(computeStatus(st({}), now, 3, ['sftp'], false).health, 'sin-configurar');
  assert.equal(computeStatus(st({}), now, 3, ['sftp'], true).health, 'nunca');
  assert.equal(computeStatus(done('2026-11-07', '2026-11-07'), now, 3, ['sftp'], true).health, 'ok');
  assert.equal(computeStatus(done('2026-11-07', null), now, 3, [], true).health, 'solo-local');
  // Se hizo local pero no subió: atrasado (no "ok")
  assert.equal(computeStatus(done('2026-11-07', '2026-11-06'), now, 3, ['sftp'], true).health, 'atrasado');
  assert.equal(computeStatus(done('2026-11-06', '2026-11-06'), now, 3, ['sftp'], true).health, 'atrasado');
  assert.equal(computeStatus(done('2026-11-05', '2026-11-05'), now, 3, ['sftp'], true).health, 'falla');
  // A la 1 de la mañana, el de ayer alcanza
  assert.equal(computeStatus(done('2026-11-06', '2026-11-06'), at('2026-11-07', 1), 3, ['sftp'], true).health, 'ok');
});
