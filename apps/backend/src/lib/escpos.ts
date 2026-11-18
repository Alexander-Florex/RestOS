// ──────────────────────────────────────────────
// escpos.ts — Pasa un ticket (src/shared/ticket.ts) a los bytes que entiende la
// comandera (ESC/POS, el lenguaje de casi todas las impresoras térmicas).
// Tabla de caracteres CP858 (ESC t 19). Si la impresora del local usa otra
// (se ve con la hoja de autoprueba), se cambia `codePage`.
// ──────────────────────────────────────────────
import { CP858, printable, type TicketDoc, type TicketLine } from '../shared/ticket.js';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export interface EscPosOptions {
  /** Número de tabla para ESC t (19 = CP858 en Epson, Xprinter y la mayoría) */
  codePage?: number;
  /** Líneas en blanco antes de cortar (para que el corte no se coma la última línea) */
  feedBeforeCut?: number;
  cut?: boolean;
}

function encodeText(text: string): number[] {
  const out: number[] = [];
  for (const ch of printable(text)) {
    const mapped = CP858[ch];
    out.push(mapped ?? ch.charCodeAt(0));
  }
  return out;
}

/** ESC ! n: bit 3 negrita, bit 4 alto doble, bit 5 ancho doble */
function modeByte(line: TicketLine): number {
  let n = 0;
  if (line.bold) n |= 0x08;
  if (line.size === 'tall' || line.size === 'double') n |= 0x10;
  if (line.size === 'double') n |= 0x20;
  return n;
}

const ALIGN = { left: 0, center: 1, right: 2 } as const;

export function toEscPos(doc: TicketDoc, opts: EscPosOptions = {}): Buffer {
  const bytes: number[] = [ESC, 0x40, ESC, 0x74, opts.codePage ?? 19];
  for (const line of doc.lines) {
    bytes.push(ESC, 0x61, ALIGN[line.align ?? 'left']);
    bytes.push(ESC, 0x21, modeByte(line));
    // La negrita de ESC ! no la respetan todas: se refuerza con ESC E
    bytes.push(ESC, 0x45, line.bold ? 1 : 0);
    bytes.push(...encodeText(line.text), LF);
  }
  bytes.push(ESC, 0x21, 0, ESC, 0x45, 0, ESC, 0x61, 0);
  bytes.push(ESC, 0x64, opts.feedBeforeCut ?? 4);
  if (opts.cut !== false) bytes.push(GS, 0x56, 0x01); // corte parcial
  return Buffer.from(bytes);
}
