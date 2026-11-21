// ──────────────────────────────────────────────
// ticket.ts — Cómo se ve cada ticket (comanda y ticket de caja), línea por línea.
//
// Un solo armado para todo: el backend lo pasa a bytes ESC/POS para la impresora
// (src/lib/escpos.ts) y la pantalla "Comandera" lo dibuja tal cual. Así lo que se
// ve en pantalla es lo que sale en papel.
// Compartido con el frontend por `@shared/ticket`: sin imports.
//
// Ancho del papel: 80 mm = 48 caracteres por línea (24 en letra doble);
// 58 mm = 32 (16 en letra doble).
// ──────────────────────────────────────────────

export type PaperWidth = 58 | 80;
export const PAPER_WIDTHS: PaperWidth[] = [80, 58];

/**
 * normal: 1 × 1 · tall: alto doble (mismo ancho) · double: ancho y alto doble
 * (la mitad de caracteres por línea).
 */
export type TicketSize = 'normal' | 'tall' | 'double';

export interface TicketLine {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  size?: TicketSize;
}

export interface TicketDoc {
  paperWidth: PaperWidth;
  /** Caracteres por línea en letra normal */
  columns: number;
  lines: TicketLine[];
}

/** Lo que se manda a imprimir (es también lo que recibe el agente por socket). */
export interface PrintPayload {
  /** test: hoja de prueba de la impresora (acentos, tamaños, ancho y corte) */
  type: 'kitchen' | 'cash' | 'test';
  /** Título grande opcional de la comanda: "REHACER", "CAMBIO" (sin esto: COCINA / PARA LLEVAR) */
  heading?: string;
  tableNumber?: number;
  tableName?: string | null;
  /** Cómo se llama la mesa en el local: "Ventana", "Ventana + Patio" o "Mesa 5" */
  tableLabel?: string;
  orderNumber?: number;
  saleNumber?: number;
  isTakeaway?: boolean;
  takeawayName?: string | null;
  /** Para llevar: quién retira. A cuenta: de qué cliente es la deuda */
  customerName?: string | null;
  waiterName?: string | null;
  items: Array<{
    name?: string;
    itemName?: string;
    quantity: number;
    price?: number;
    /** Opciones + nota juntas (compatibilidad con agentes viejos) */
    notes?: string | null;
    /** Solo la nota del mozo (si viene, se usa junto con modifiers en vez de notes) */
    note?: string | null;
    /** Opciones del plato, una por línea: "SIN cebolla", "Término: A punto" */
    modifiers?: string[];
    /** Título del grupo en la comanda: "Entradas", "Principal", "Postres" */
    course?: string | null;
  }>;
  subtotal?: number;
  discount?: number;
  discountPct?: number | null;
  discountReason?: string | null;
  total?: number;
  amountPaid?: number;
  paymentMethod?: string;
  payments?: Array<{ method: string; amount: number; tendered?: number | null }>;
  notes?: string | null;
}

export interface TicketHeader {
  restaurantName: string;
  address?: string | null;
  phone?: string | null;
  printedAt: Date;
  timeZone: string;
  paperWidth: PaperWidth;
}

/**
 * Tabla de caracteres PC850 (multilingüe, ESC t 2: el mismo número en Xprinter y Epson): letras con tilde,
 * ñ, ¿¡, punto medio. Lo que no está en la tabla sale como "?", y la pantalla lo
 * muestra igual, para que se note antes de imprimir.
 */
export const CP850: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'ç': 0x87, 'ê': 0x88, 'ë': 0x89, 'è': 0x8a,
  'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'É': 0x90, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
  'Ö': 0x99, 'Ü': 0x9a, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7,
  '¿': 0xa8, '½': 0xab, '¼': 0xac, '¡': 0xad, 'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, 'Ê': 0xd2, 'Ë': 0xd3, 'È': 0xd4,
  'Í': 0xd6, 'Î': 0xd7, 'Ï': 0xd8, 'Ó': 0xe0, 'Ô': 0xe2, 'Ò': 0xe3, 'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb,
  '°': 0xf8, '·': 0xfa,
};

const REPLACE: Record<string, string> = {
  '“': '"', '”': '"', '‘': "'", '’': "'", '–': '-', '—': '-', '…': '...', '×': 'x', '\u00a0': ' ', '\t': ' ',
};

/** El texto tal como lo puede imprimir la comandera (lo que no existe en CP850 queda "?"). */
export function printable(text: string): string {
  let out = '';
  for (const ch of text) {
    const r = REPLACE[ch];
    if (r !== undefined) { out += r; continue; }
    const c = ch.codePointAt(0)!;
    out += (c >= 0x20 && c < 0x7f) || CP850[ch] !== undefined ? ch : '?';
  }
  return out;
}

export function columnsFor(width: PaperWidth): number {
  return width === 58 ? 32 : 48;
}

/** Caracteres que entran en una línea con ese tamaño de letra */
export function lineCapacity(columns: number, size: TicketSize = 'normal'): number {
  return size === 'double' ? Math.floor(columns / 2) : columns;
}

/** Corta un texto en líneas de `width` caracteres, por palabras (las palabras largas se parten). */
export function wrap(text: string, width: number, indent = ''): string[] {
  const out: string[] = [];
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return out;
  const capOf = (n: number) => (n === 0 ? width : Math.max(1, width - indent.length));
  const push = (line: string) => { out.push(out.length === 0 ? line : indent + line); };
  let line = '';
  for (let word of clean.split(' ')) {
    if (line && line.length + 1 + word.length <= capOf(out.length)) { line += ' ' + word; continue; }
    if (line) { push(line); line = ''; }
    while (word.length > capOf(out.length)) {
      const c = capOf(out.length);
      push(word.slice(0, c));
      word = word.slice(c);
    }
    line = word;
  }
  if (line) push(line);
  return out;
}

/** "Izquierda ........ derecha" en una línea; si no entra, la izquierda se corta en varias. */
export function justify(left: string, right: string, width: number, fill = ' '): string[] {
  const lead = left.match(/^ */)![0];
  if (lead) return justify(left.slice(lead.length), right, width - lead.length, fill).map(l => lead + l);
  const room = width - right.length - 1;
  if (room < 4) return [...wrap(left, width), right.padStart(width)];
  const parts = wrap(left, room, '   ');
  if (parts.length === 0) parts.push('');
  const last = parts.pop()!;
  return [...parts, last + fill.repeat(Math.max(1, width - last.length - right.length)) + right];
}

const PAY_LABEL: Record<string, string> = {
  CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia', ACCOUNT: 'A cuenta', MIXED: 'Varios medios',
};
export function paymentLabel(method: string): string {
  return PAY_LABEL[method] ?? method;
}

export function formatMoney(n: number): string {
  const fixed = (Math.round(n * 100) / 100).toFixed(2);
  const [int, dec] = fixed.replace('-', '').split('.');
  return `${n < 0 ? '-' : ''}$${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

function clock(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-AR', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
function day(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat('es-AR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

class Builder {
  lines: TicketLine[] = [];
  constructor(readonly columns: number) {}
  cap(size: TicketSize = 'normal') { return lineCapacity(this.columns, size); }
  add(text: string, opts: Omit<TicketLine, 'text'> = {}, indent = '') {
    text = printable(text);
    const width = this.cap(opts.size);
    const parts = text.length <= width ? [text] : wrap(text, width, indent);
    for (const p of parts.length ? parts : ['']) this.lines.push({ text: p, ...opts });
  }
  raw(text: string, opts: Omit<TicketLine, 'text'> = {}) { this.lines.push({ text: printable(text), ...opts }); }
  blank() { this.lines.push({ text: '' }); }
  rule(ch = '-') { this.lines.push({ text: ch.repeat(this.columns) }); }
}

function itemName(i: PrintPayload['items'][number]) {
  return (i.name ?? i.itemName ?? '').trim() || 'Plato';
}

/** Opciones y nota del plato, en líneas separadas. */
function itemExtras(i: PrintPayload['items'][number]): { options: string[]; note: string | null } {
  if (i.modifiers && i.modifiers.length > 0) return { options: i.modifiers, note: i.note ?? null };
  if (i.note !== undefined) return { options: [], note: i.note };
  return { options: [], note: i.notes ?? null };
}

function placeLabel(p: PrintPayload): string {
  if (p.isTakeaway) return p.takeawayName ? `Para llevar: ${p.takeawayName}` : 'Para llevar';
  if (p.tableLabel) return p.tableLabel;
  return p.tableNumber ? `Mesa ${p.tableNumber}` : '';
}

// ──────────────────────────────────────────────
// Comanda de cocina: sin precios, platos grandes, opciones y notas destacadas
// ──────────────────────────────────────────────
export function kitchenTicket(p: PrintPayload, h: TicketHeader): TicketDoc {
  const b = new Builder(columnsFor(h.paperWidth));
  b.add(h.restaurantName, { align: 'center', bold: true });
  b.add(p.heading ?? (p.isTakeaway ? 'PARA LLEVAR' : 'COCINA'), { align: 'center', bold: true, size: 'double' });
  b.rule('=');
  const where = p.isTakeaway ? (p.takeawayName || 'Para llevar') : placeLabel(p);
  if (where) b.add(where.toUpperCase(), { bold: true, size: 'double' });
  for (const l of justify(p.orderNumber ? `Pedido #${p.orderNumber}` : '', clock(h.printedAt, h.timeZone), b.columns)) b.raw(l, { bold: true });
  if (p.waiterName) b.add(`Mozo: ${p.waiterName}`);
  b.rule('=');

  let count = 0;
  const hasCourses = p.items.some(i => i.course);
  let currentCourse: string | null = null;
  for (const item of p.items) {
    count += item.quantity;
    const course = hasCourses ? (item.course || 'Otros') : null;
    if (course && course !== currentCourse) {
      if (currentCourse) b.blank();
      b.blank();
      b.add(course.toUpperCase(), { align: 'center', bold: true, size: 'tall' });
      b.rule('-');
      currentCourse = course;
    } else {
      b.blank();
    }
    const qty = `${item.quantity}x `;
    b.add(qty + itemName(item), { bold: true, size: 'double' }, ' '.repeat(qty.length));
    const { options, note } = itemExtras(item);
    for (const o of options) for (const l of wrap(o, b.columns - 3, '   ')) b.raw(`   ${l}`, { bold: true, size: 'tall' });
    if (note) for (const l of wrap(`>> ${note}`, b.columns - 3, '      ')) b.raw(`   ${l}`, { bold: true });
  }
  b.blank();
  b.rule('-');
  b.add(`${count} ${count === 1 ? 'plato' : 'platos'} · ${day(h.printedAt, h.timeZone)} ${clock(h.printedAt, h.timeZone)}`, { align: 'center' });
  if (p.notes) b.add(`Nota: ${p.notes}`, { bold: true });
  return { paperWidth: h.paperWidth, columns: b.columns, lines: b.lines };
}

// ──────────────────────────────────────────────
// Ticket de caja: con precios, descuento, total y cómo se pagó (no fiscal)
// ──────────────────────────────────────────────
export function cashTicket(p: PrintPayload, h: TicketHeader): TicketDoc {
  const b = new Builder(columnsFor(h.paperWidth));
  b.add(h.restaurantName, { align: 'center', bold: true, size: 'double' });
  if (h.address) b.add(h.address, { align: 'center' });
  if (h.phone) b.add(`Tel. ${h.phone}`, { align: 'center' });
  b.blank();
  b.add('TICKET DE CAJA', { align: 'center', bold: true });
  b.add('No válido como factura', { align: 'center' });
  b.rule('-');
  const where = placeLabel(p);
  if (where) b.add(p.isTakeaway ? where : `Mesa: ${where}`, { bold: true });
  for (const l of justify(`Fecha: ${day(h.printedAt, h.timeZone)}`, `${clock(h.printedAt, h.timeZone)} hs`, b.columns)) b.raw(l);
  if (p.saleNumber) b.add(`Venta #${p.saleNumber}`);
  b.rule('-');

  for (const item of p.items) {
    const price = formatMoney((item.price ?? 0) * item.quantity);
    for (const l of justify(`${item.quantity}x ${itemName(item)}`, price, b.columns)) b.raw(l);
    const { options } = itemExtras(item);
    for (const o of options) for (const l of wrap(o, b.columns - 3, '   ')) b.raw(`   ${l}`);
  }
  b.rule('-');

  const total = p.total ?? p.items.reduce((s, i) => s + (i.price ?? 0) * i.quantity, 0);
  if (p.discount && p.discount > 0) {
    const subtotal = p.subtotal ?? total + p.discount;
    for (const l of justify('Subtotal', formatMoney(subtotal), b.columns)) b.raw(l);
    const label = `Descuento${p.discountPct ? ` ${Number(p.discountPct)} %` : ''}${p.discountReason ? ` (${p.discountReason})` : ''}`;
    for (const l of justify(label, formatMoney(-p.discount), b.columns)) b.raw(l);
  }
  const half = lineCapacity(b.columns, 'double');
  const totalText = formatMoney(total);
  if (totalText.length + 7 <= half) {
    for (const l of justify('TOTAL', totalText, half)) b.raw(l, { bold: true, size: 'double' });
  } else {
    b.add('TOTAL', { bold: true, size: 'double' });
    b.add(totalText, { bold: true, size: 'double', align: 'right' });
  }
  b.rule('-');

  if (p.paymentMethod === 'ACCOUNT') {
    b.add(`A CUENTA DE: ${(p.customerName ?? '').toUpperCase()}`, { bold: true });
    b.blank();
    b.blank();
    b.add('Firma: ' + '_'.repeat(Math.max(10, b.columns - 7)));
    b.blank();
    b.add('Aclaración: ' + '_'.repeat(Math.max(10, b.columns - 12)));
  } else {
    const payments = p.payments && p.payments.length > 0
      ? p.payments
      : p.paymentMethod ? [{ method: p.paymentMethod, amount: total, tendered: p.amountPaid && p.amountPaid > total ? p.amountPaid : null }] : [];
    for (const pay of payments) {
      for (const l of justify(paymentLabel(pay.method), formatMoney(pay.amount), b.columns)) b.raw(l, { bold: true });
      if (pay.tendered && pay.tendered > pay.amount) {
        for (const l of justify('   Entregó', formatMoney(pay.tendered), b.columns)) b.raw(l);
        for (const l of justify('   Vuelto', formatMoney(pay.tendered - pay.amount), b.columns)) b.raw(l, { bold: true });
      }
    }
  }
  if (p.notes) { b.blank(); b.add(`Nota: ${p.notes}`); }
  b.blank();
  b.add('¡Gracias por su visita!', { align: 'center' });
  return { paperWidth: h.paperWidth, columns: b.columns, lines: b.lines };
}

// ──────────────────────────────────────────────
// Hoja de prueba: para ver de un vistazo que la impresora anda bien
// ──────────────────────────────────────────────
export function testTicket(h: TicketHeader): TicketDoc {
  const b = new Builder(columnsFor(h.paperWidth));
  b.add(h.restaurantName, { align: 'center', bold: true });
  b.add('PRUEBA', { align: 'center', bold: true, size: 'double' });
  b.add(`${day(h.printedAt, h.timeZone)} ${clock(h.printedAt, h.timeZone)}`, { align: 'center' });
  b.rule('=');
  b.add('Acentos y eñes:', { bold: true });
  b.add('áéíóú ÁÉÍÓÚ ñÑ ü ¿? ¡! ° ½ ª º');
  b.add('Ñoquis con puré · Jamón y morrón');
  b.blank();
  b.add('Tamaños:', { bold: true });
  b.add('Normal');
  b.add('Negrita', { bold: true });
  b.add('Alta', { bold: true, size: 'tall' });
  b.add('Doble', { bold: true, size: 'double' });
  b.blank();
  b.add(`Ancho: ${b.columns} caracteres (papel de ${h.paperWidth} mm)`, { bold: true });
  b.raw('1234567890'.repeat(Math.ceil(b.columns / 10)).slice(0, b.columns));
  b.raw('<' + '-'.repeat(b.columns - 2) + '>');
  b.rule('=');
  b.add('Si ves bien la ñ, los acentos y la regla entera, la comandera está lista.', { align: 'center' });
  b.add('Si sale cortado o con símbolos raros, avisá.', { align: 'center' });
  return { paperWidth: h.paperWidth, columns: b.columns, lines: b.lines };
}

export function buildTicket(p: PrintPayload, h: TicketHeader): TicketDoc {
  if (p.type === 'test') return testTicket(h);
  return p.type === 'cash' ? cashTicket(p, h) : kitchenTicket(p, h);
}

/** Título corto para listar el trabajo: "Comanda · Ventana · #12" */
export function ticketTitle(p: PrintPayload): string {
  if (p.type === 'test') return 'Prueba de impresora';
  const kind = p.type === 'cash' ? 'Ticket de caja' : p.heading ? `Comanda (${p.heading.toLowerCase()})` : 'Comanda';
  const where = placeLabel(p);
  const num = p.type === 'cash' ? (p.saleNumber ? `Venta #${p.saleNumber}` : '') : (p.orderNumber ? `#${p.orderNumber}` : '');
  return [kind, where, num].filter(Boolean).join(' · ');
}

/** Ejemplos para ver cómo queda sin cargar un pedido */
export function sampleTicket(kind: 'kitchen' | 'cash' | 'test'): PrintPayload {
  if (kind === 'test') return { type: 'test', items: [] };
  if (kind === 'kitchen') {
    return {
      type: 'kitchen', tableNumber: 5, tableLabel: 'Ventana', orderNumber: 1234, waiterName: 'Juan',
      items: [
        { name: 'Empanadas de carne', quantity: 2, course: 'Entradas' },
        { name: 'Tequeños', quantity: 1, course: 'Entradas', note: 'Sin sal, alérgico' },
        { name: 'Milanesa napolitana con papas fritas', quantity: 2, course: 'Principal', modifiers: ['SIN jamón', '+ Huevo frito'], note: 'Una bien cocida' },
        { name: 'Bife de chorizo', quantity: 1, course: 'Principal', modifiers: ['Término: A punto', 'Guarnición: Puré de calabaza'] },
      ],
    };
  }
  return {
    type: 'cash', tableNumber: 5, tableLabel: 'Ventana', saleNumber: 987,
    items: [
      { name: 'Milanesa napolitana con papas fritas', quantity: 2, price: 14500, modifiers: ['+ Huevo frito'] },
      { name: 'Bife de chorizo', quantity: 1, price: 18900 },
      { name: 'Agua mineral 500 ml', quantity: 3, price: 2200 },
      { name: 'Flan casero', quantity: 3, price: 4800 },
    ],
    subtotal: 68900, discount: 6890, discountPct: 10, discountReason: 'Promo efectivo', total: 62010,
    paymentMethod: 'CASH', payments: [{ method: 'CASH', amount: 62010, tendered: 70000 }],
  };
}
