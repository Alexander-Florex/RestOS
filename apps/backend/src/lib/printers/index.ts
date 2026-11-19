// ──────────────────────────────────────────────
// printers/index.ts — A qué impresora se manda y cómo (tarea 1.1).
//
// `restaurants.printerName` dice dónde está la comandera:
//   - un nombre de Windows ("XP-80C", "POS-80"): impresora por USB instalada en la PC
//     del servidor; se imprime en RAW por la cola de Windows (windows.ts);
//   - una IP ("192.168.1.50" o "192.168.1.50:9100"): impresora por red; los bytes se
//     mandan directo al puerto 9100.
// ──────────────────────────────────────────────
import net from 'node:net';
import { printRawWindows } from './windows.js';

export type PrinterTarget =
  | { kind: 'network'; host: string; port: number }
  | { kind: 'windows'; name: string };

const IP = /^(?:tcp:\/\/)?(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/i;

export function parsePrinterTarget(value: string): PrinterTarget {
  const v = value.trim();
  const m = IP.exec(v);
  if (m) return { kind: 'network', host: m[1], port: m[2] ? Number(m[2]) : 9100 };
  return { kind: 'windows', name: v };
}

/** Manda bytes ESC/POS a una impresora de red (puerto 9100, "RAW/JetDirect") */
export function printNetwork(host: string, port: number, data: Buffer, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err); else resolve();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error(`La impresora ${host} no respondió: revisá que esté prendida y conectada a la red`)));
    socket.on('error', (err: NodeJS.ErrnoException) => {
      const why = err.code === 'ECONNREFUSED' ? 'rechazó la conexión'
        : err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH' ? 'no está en la red'
        : err.message;
      finish(new Error(`No se pudo imprimir en ${host}: ${why}`));
    });
    socket.on('connect', () => {
      socket.end(data, () => finish());
    });
  });
}

export interface PrinterTransport {
  print(target: string, title: string, data: Buffer): Promise<void>;
}

export const realTransport: PrinterTransport = {
  async print(target, title, data) {
    const t = parsePrinterTarget(target);
    if (t.kind === 'network') return printNetwork(t.host, t.port, data);
    return printRawWindows(t.name, title, data);
  },
};
