// ──────────────────────────────────────────────
// backup/crypto.ts — Cifrado de los respaldos (tarea 6.3)
//
// AES-256-GCM con una llave derivada de BACKUP_PASSPHRASE (scrypt), sin
// dependencias. Formato del archivo .enc:
//   "RESTOSBK" (8) · versión (1) · sal (16) · iv (12) · datos cifrados · tag (16)
// GCM detecta cualquier cambio: un archivo dañado o una contraseña equivocada
// dan error al restaurar en vez de un volcado corrupto.
// ──────────────────────────────────────────────
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Writable, type Readable } from 'node:stream';

const MAGIC = Buffer.from('RESTOSBK');
const VERSION = 1;
const HEADER = MAGIC.length + 1 + 16 + 12;
const TAG = 16;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** Cifra un flujo y lo escribe en `dest`. */
export async function encryptStream(source: Readable, dest: string, passphrase: string): Promise<void> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const out = createWriteStream(dest);
  out.write(Buffer.concat([MAGIC, Buffer.from([VERSION]), salt, iv]));
  await pipeline(source, cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (err?: Error | null) => (err ? reject(err) : resolve())));
}

export async function encryptFile(src: string, dest: string, passphrase: string): Promise<void> {
  await encryptStream(createReadStream(src), dest, passphrase);
}

/** Descifra `src` y pasa el contenido a `sink`. Falla si la contraseña o el archivo no son correctos. */
export async function decryptTo(src: string, sink: Writable, passphrase: string): Promise<void> {
  const size = (await stat(src)).size;
  if (size < HEADER + TAG) throw new Error('El archivo de respaldo está vacío o incompleto');
  const fh = await open(src, 'r');
  const head = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(TAG);
  try {
    await fh.read(head, 0, HEADER, 0);
    await fh.read(tag, 0, TAG, size - TAG);
  } finally {
    await fh.close();
  }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('No es un respaldo de RestOS');
  if (head[MAGIC.length] !== VERSION) throw new Error(`Versión de respaldo desconocida (${head[MAGIC.length]})`);
  const salt = head.subarray(MAGIC.length + 1, MAGIC.length + 17);
  const iv = head.subarray(MAGIC.length + 17, HEADER);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(src, { start: HEADER, end: size - TAG - 1 }), decipher, sink);
  } catch (err) {
    if (err instanceof Error && /auth|unable to authenticate/i.test(err.message)) {
      throw new Error('No se pudo descifrar: la contraseña (BACKUP_PASSPHRASE) no es la correcta o el archivo está dañado');
    }
    throw err;
  }
}

export async function decryptFile(src: string, dest: string, passphrase: string): Promise<void> {
  await decryptTo(src, createWriteStream(dest), passphrase);
}
