// ──────────────────────────────────────────────
// printing.service.ts — Xprinter POS-58 (58mm)
// ──────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prisma } from '../../lib/prisma.js';
import { HttpError } from '../../lib/http-error.js';

const ESC = 0x1b;
const GS  = 0x1d;
const CMD = {
  INIT:        Buffer.from([ESC, 0x40]),
  ALIGN_LEFT:  Buffer.from([ESC, 0x61, 0x00]),
  ALIGN_CENTER:Buffer.from([ESC, 0x61, 0x01]),
  BOLD_ON:     Buffer.from([ESC, 0x45, 0x01]),
  BOLD_OFF:    Buffer.from([ESC, 0x45, 0x00]),
  SIZE_2X:     Buffer.from([ESC, 0x21, 0x30]), // doble ancho + alto
  SIZE_TALL:   Buffer.from([ESC, 0x21, 0x10]), // solo alto doble
  NORMAL_SIZE: Buffer.from([ESC, 0x21, 0x00]),
  CUT_PARTIAL: Buffer.from([GS,  0x56, 0x01]),
  LINE_FEED:   Buffer.from([0x0a]),
  FEED_4:      Buffer.from([ESC, 0x64, 0x04]),
  SET_CP858:   Buffer.from([ESC, 0x74, 0x13]), // codepage 858
};

const W = 32; // ancho en fuente normal
const W2 = 16; // ancho en fuente 2x

// CP858 — tabla real de la Xprinter POS-58
function toCP858(s: string): Buffer {
  const b: number[] = [];
  for (const ch of s) {
    switch (ch) {
      case 'á': b.push(0xa0); break; case 'é': b.push(0x82); break;
      case 'í': b.push(0xa1); break; case 'ó': b.push(0xa2); break;
      case 'ú': b.push(0xa3); break; case 'ñ': b.push(0xa4); break;
      case 'ü': b.push(0x81); break; case 'ç': b.push(0x87); break;
      case 'Á': b.push(0xb5); break; case 'É': b.push(0x90); break;
      case 'Í': b.push(0xd6); break; case 'Ó': b.push(0xe0); break;
      case 'Ú': b.push(0xe9); break; case 'Ñ': b.push(0xa5); break;
      case 'Ü': b.push(0x9a); break; case 'Ç': b.push(0x80); break;
      case '¿': b.push(0xa8); break; case '¡': b.push(0xad); break;
      case '€': b.push(0xd5); break;
      default: {
        const c = ch.charCodeAt(0);
        b.push(c < 256 ? c : 0x3f);
      }
    }
  }
  return Buffer.from(b);
}

function ln(s = '', max = W): Buffer {
  return Buffer.concat([toCP858(s.slice(0, max)), CMD.LINE_FEED]);
}
function div(ch = '-', w = W): Buffer { return ln(ch.repeat(w), w); }

// "Nx Nombre...........$precio" en fuente normal
function rowNormal(name: string, price: string, qty: number): Buffer {
  const label = `${qty}x ${name}`;
  const trunc = label.slice(0, W - price.length - 1);
  const dots  = '.'.repeat(Math.max(1, W - trunc.length - price.length));
  return ln(`${trunc}${dots}${price}`);
}

// "Nx Nombre" en fuente 2x para cocina
function rowKitchen(name: string, qty: number): Buffer {
  return Buffer.concat([
    CMD.SIZE_2X,
    toCP858(`${qty}x ${name}`.slice(0, W2)),
    CMD.LINE_FEED,
    CMD.NORMAL_SIZE,
  ]);
}

// ──────────────────────────────────────────────
// TICKET COCINA — sin precios, items grandes
// ──────────────────────────────────────────────
export function buildKitchenTicket(data: {
  restaurantName: string;
  tableNumber: number;
  orderNumber: number;
  printedAt: Date;
  items: Array<{ name: string; quantity: number; notes?: string | null }>;
}): Buffer {
  const p: Buffer[] = [];
  const push = (...b: Buffer[]) => b.forEach(x => p.push(x));

  const hora = data.printedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  push(CMD.INIT, CMD.SET_CP858);
  push(CMD.ALIGN_CENTER, CMD.SIZE_TALL, CMD.BOLD_ON);
  push(ln(data.restaurantName, W2));
  push(CMD.NORMAL_SIZE, CMD.BOLD_OFF, CMD.LINE_FEED);

  push(CMD.SIZE_2X, CMD.BOLD_ON);
  push(ln('** COCINA **', W2));
  push(CMD.NORMAL_SIZE, CMD.BOLD_OFF, CMD.LINE_FEED);

  push(CMD.ALIGN_LEFT);
  push(div('='));
  push(CMD.SIZE_TALL, CMD.BOLD_ON);
  push(ln(`MESA  N${String(data.tableNumber).padStart(2, '0')}`, W2));
  push(CMD.NORMAL_SIZE, CMD.BOLD_OFF);
  push(CMD.BOLD_ON);
  push(ln(`Hora: ${hora}`));
  push(ln(`Orden N: ${data.orderNumber}`));
  push(CMD.BOLD_OFF);
  push(div('='));
  push(CMD.LINE_FEED);

  for (const item of data.items) {
    push(rowKitchen(item.name, item.quantity));
    if (item.notes) {
      push(CMD.BOLD_ON, ln(`  >> ${item.notes}`), CMD.BOLD_OFF);
    }
    push(CMD.LINE_FEED);
  }

  push(div('-'));
  push(CMD.ALIGN_CENTER, ln('- Pedido listo -'), CMD.LINE_FEED);
  push(CMD.FEED_4, CMD.CUT_PARTIAL);
  return Buffer.concat(p);
}

// ──────────────────────────────────────────────
// TICKET CAJA — con precios, total y forma de pago
// Correcciones aplicadas:
// - Sin signo ? al inicio/fin
// - Sin encabezado CANT/DESCRIPCION/PRECIO
// - Sin línea "Cobrado" (el total ya está en grande)
// - Vuelto solo si corresponde
// ──────────────────────────────────────────────
export function buildCashTicket(data: {
  restaurantName: string;
  tableNumber: number;
  printedAt: Date;
  items: Array<{ name: string; quantity: number; price: number; notes?: string | null }>;
  total: number;
  amountPaid: number;
  paymentMethod: string;
  notes?: string | null;
}): Buffer {
  const p: Buffer[] = [];
  const push = (...b: Buffer[]) => b.forEach(x => p.push(x));

  const money = (n: number) =>
    `$${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const hora  = data.printedAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const fecha = data.printedAt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const PAY: Record<string, string> = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia' };
  const payLabel = PAY[data.paymentMethod] ?? data.paymentMethod;

  push(CMD.INIT, CMD.SET_CP858);

  // Encabezado
  push(CMD.ALIGN_CENTER, CMD.SIZE_TALL, CMD.BOLD_ON);
  push(ln(data.restaurantName, W2));
  push(CMD.NORMAL_SIZE, CMD.BOLD_OFF, CMD.LINE_FEED);
  push(CMD.ALIGN_CENTER, CMD.BOLD_ON);
  push(ln('== TICKET DE CAJA =='));
  push(CMD.BOLD_OFF, CMD.LINE_FEED);

  // Mesa, fecha, hora
  push(CMD.ALIGN_LEFT);
  push(div('-'));
  push(CMD.BOLD_ON);
  push(ln(`Mesa: N${String(data.tableNumber).padStart(2, '0')}`));
  push(CMD.BOLD_OFF);
  push(ln(`Fecha: ${fecha}   ${hora}hs`));
  push(div('-'));
  push(CMD.LINE_FEED);

  // Items (sin encabezado de columnas)
  for (const item of data.items) {
    push(rowNormal(item.name, money(item.price * item.quantity), item.quantity));
    if (item.notes) push(ln(`  > ${item.notes}`));
  }

  // Total en grande
  push(CMD.LINE_FEED);
  push(div('-'));
  push(CMD.ALIGN_CENTER, CMD.SIZE_TALL, CMD.BOLD_ON);
  push(ln(`TOTAL  ${money(data.total)}`, W2));
  push(CMD.NORMAL_SIZE, CMD.BOLD_OFF);
  push(div('-'));
  push(CMD.LINE_FEED);

  // Forma de pago (sin "Cobrado")
  push(CMD.ALIGN_LEFT);
  push(CMD.BOLD_ON, ln(`Pago: ${payLabel}`), CMD.BOLD_OFF);

  // Vuelto solo si pagó de más
  if (data.amountPaid > data.total) {
    push(CMD.BOLD_ON);
    push(ln(`Vuelto: ${money(data.amountPaid - data.total)}`));
    push(CMD.BOLD_OFF);
  }

  if (data.notes) {
    push(CMD.LINE_FEED, ln(`Nota: ${data.notes}`));
  }

  // Pie
  push(CMD.LINE_FEED, div('-'));
  push(CMD.ALIGN_CENTER);
  push(ln('Gracias por su visita!'));
  push(CMD.LINE_FEED, CMD.FEED_4, CMD.CUT_PARTIAL);
  return Buffer.concat(p);
}

// ── Impresoras ──
export interface PrinterInfo { name: string; isDefault?: boolean; port?: string; }

export function listWindowsPrinters(): PrinterInfo[] {
  const r = spawnSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Get-Printer | ForEach-Object { $_.Name + '|' + $_.Default + '|' + $_.PortName }`,
  ], { encoding: 'utf8', timeout: 6000, windowsHide: true });

  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.trim().split('\n')
    .map(l => l.trim().replace(/\r/g, '')).filter(l => l.includes('|'))
    .map(l => {
      const parts = l.split('|');
      return { name: (parts[0]??'').trim(), isDefault: (parts[1]??'').trim().toLowerCase()==='true', port: (parts[2]??'').trim() };
    }).filter(p => p.name);
}

export function printRawToWindows(ticketBuffer: Buffer, printerName: string): void {
  const ts = Date.now();
  const prnFile = join(tmpdir(), `restos_${ts}.prn`);
  try {
    writeFileSync(prnFile, ticketBuffer);
    const infoResult = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `$p = Get-Printer -Name '${printerName.replace(/'/g, "''")}' -ErrorAction SilentlyContinue; ` +
      `"$env:COMPUTERNAME|" + $(if($p.Shared -and $p.ShareName){ $p.ShareName } else { '' })`,
    ], { encoding: 'utf8', timeout: 6000, windowsHide: true });
    const parts = (infoResult.stdout??'').trim().replace(/\r/g,'').split('|');
    const hostname  = (parts[0]??'').trim().toLowerCase();
    const shareName = (parts[1]??'').trim();
    console.log(`[Printing] hostname=${hostname}, share="${shareName}"`);
    if (!hostname) throw new Error('No se pudo obtener el hostname');
    if (!shareName) throw new Error(`Impresora "${printerName}" no está compartida. Ejecutá en PS Admin: Set-Printer -Name "${printerName}" -Shared $true -ShareName "XPrinter"`);
    const unc = `\\\\${hostname}\\${shareName}`;
    const copyCmd = `copy /b ${prnFile} ${unc}`;
    console.log(`[Printing] ${copyCmd}`);
    const r = spawnSync('cmd', ['/c', copyCmd], { timeout: 12000, windowsHide: true, encoding: 'utf8', shell: false });
    const out = (r.stdout||r.stderr||'').toString().trim();
    console.log(`[Printing] ${out}`);
    if (r.status === 0) { console.log('[Printing] OK'); return; }
    throw new Error(`copy falló: ${out.slice(0,200)}`);
  } finally {
    if (existsSync(prnFile)) try { unlinkSync(prnFile); } catch { /**/ }
  }
}

// ── Service ──
export const printingService = {
  async listPrinters(): Promise<{ printers: PrinterInfo[]; platform: string }> {
    const platform = process.platform;
    if (platform !== 'win32') return { printers: [], platform };
    return { printers: listWindowsPrinters(), platform };
  },

  // Ticket de COCINA — sin precios, desde el pedido en BD
  async printOrder(opts: { orderId: number; printerName: string; restaurantName: string; }): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: opts.orderId },
      include: { items: true, table: true },
    });
    if (!order) throw HttpError.notFound('Pedido no encontrado');
    const ticket = buildKitchenTicket({
      restaurantName: opts.restaurantName,
      tableNumber:    order.table?.number ?? 0,
      orderNumber:    order.id,
      printedAt:      new Date(),
      items: order.items.map(i => ({ name: i.itemName, quantity: i.quantity, notes: i.notes })),
    });
    if (process.platform !== 'win32') { console.log('[Printing] Simulado cocina'); return; }
    printRawToWindows(ticket, opts.printerName);
  },

  // Ticket de CAJA — recibe los datos directamente del frontend
  // (no busca en BD porque los orders ya se borraron al cerrar la venta)
  async printCashTicketDirect(opts: {
    printerName: string;
    restaurantName: string;
    tableNumber: number;
    items: Array<{ name: string; quantity: number; price: number }>;
    total: number;
    amountPaid: number;
    paymentMethod: string;
    notes?: string | null;
  }): Promise<void> {
    const ticket = buildCashTicket({
      restaurantName: opts.restaurantName,
      tableNumber:    opts.tableNumber,
      printedAt:      new Date(),
      items:          opts.items,
      total:          opts.total,
      amountPaid:     opts.amountPaid,
      paymentMethod:  opts.paymentMethod,
      notes:          opts.notes,
    });
    if (process.platform !== 'win32') { console.log('[Printing] Simulado caja'); return; }
    printRawToWindows(ticket, opts.printerName);
  },

  // Mantenido por compatibilidad — busca en BD (solo usar ANTES de cerrar la venta)
  async printTableOrders(opts: {
    tableId: number; printerName: string; restaurantName: string;
    paymentMethod?: string; amountPaid?: number; notes?: string | null;
  }): Promise<void> {
    const table = await prisma.table.findUnique({
      where: { id: opts.tableId },
      include: { orders: { include: { items: true } } },
    });
    if (!table) throw HttpError.notFound('Mesa no encontrada');
    const allItems: Array<{ name: string; quantity: number; price: number; notes?: string | null }> = [];
    for (const order of table.orders) {
      for (const item of order.items) {
        const found = allItems.find(a => a.name === item.itemName && a.price === Number(item.price));
        if (found) found.quantity += item.quantity;
        else allItems.push({ name: item.itemName, quantity: item.quantity, price: Number(item.price), notes: item.notes });
      }
    }
    if (allItems.length === 0) throw HttpError.badRequest('La mesa no tiene items para imprimir');
    const total = allItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const ticket = buildCashTicket({
      restaurantName: opts.restaurantName,
      tableNumber:    table.number,
      printedAt:      new Date(),
      items:          allItems,
      total,
      amountPaid:     opts.amountPaid ?? total,
      paymentMethod:  opts.paymentMethod ?? 'CASH',
      notes:          opts.notes,
    });
    if (process.platform !== 'win32') { console.log('[Printing] Simulado caja (BD)'); return; }
    printRawToWindows(ticket, opts.printerName);
  },
};
