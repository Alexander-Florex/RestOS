// ──────────────────────────────────────────────
// Comandera (tarea 1.1): armado de tickets y bytes ESC/POS, sin base de datos.
// ──────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTicket, cashTicket, kitchenTicket, justify, lineCapacity, printable, sampleTicket, ticketTitle, wrap, formatMoney,
  type PaperWidth, type PrintPayload, type TicketDoc, type TicketHeader,
} from '../src/shared/ticket.js';
import { toEscPos } from '../src/lib/escpos.js';

const header = (paperWidth: PaperWidth = 80): TicketHeader => ({
  restaurantName: 'El Molino', printedAt: new Date('2026-11-19T01:30:00Z'), // 22:30 del 18/11 en Buenos Aires
  timeZone: 'America/Argentina/Buenos_Aires', paperWidth,
});
const texts = (d: TicketDoc) => d.lines.map(l => l.text);

function assertFits(doc: TicketDoc) {
  for (const l of doc.lines) {
    assert.ok(l.text.length <= lineCapacity(doc.columns, l.size), `no entra en ${doc.paperWidth} mm: "${l.text}" (${l.size ?? 'normal'})`);
  }
}

test('wrap corta por palabras, parte las palabras largas y respeta la sangría', () => {
  assert.deepEqual(wrap('Milanesa napolitana con papas', 12), ['Milanesa', 'napolitana', 'con papas']);
  assert.deepEqual(wrap('uno dos tres cuatro', 9, '  '), ['uno dos', '  tres', '  cuatro']);
  assert.deepEqual(wrap('ABCDEFGHIJ', 4), ['ABCD', 'EFGH', 'IJ']);
  assert.deepEqual(wrap('   ', 10), []);
});

test('justify pone el importe a la derecha y corta el texto si no entra', () => {
  assert.deepEqual(justify('Subtotal', '$1.000,00', 20), ['Subtotal   $1.000,00']);
  const lines = justify('2x Milanesa napolitana con papas', '$29.000,00', 32);
  assert.equal(lines.at(-1)!.length, 32);
  assert.ok(lines.at(-1)!.endsWith('$29.000,00'));
  assert.ok(lines.every(l => l.length <= 32));
  assert.deepEqual(justify('   Vuelto', '$10,00', 20), ['   Vuelto     $10,00']);
});

test('dinero en formato argentino', () => {
  assert.equal(formatMoney(62010), '$62.010,00');
  assert.equal(formatMoney(1234567.5), '$1.234.567,50');
  assert.equal(formatMoney(-6890), '-$6.890,00');
});

test('nada se pasa del ancho del papel (80 y 58 mm), aunque los nombres sean largos', () => {
  const long: PrintPayload = {
    type: 'kitchen', tableLabel: 'Galería del fondo junto a la ventana grande', orderNumber: 99999,
    items: [{ name: 'Sorrentinos de jamón y queso con salsa mixta y extra de parmesano rallado', quantity: 12, modifiers: ['Salsa: Mixta (fileto + crema) con albahaca fresca'], note: 'Sin sal porque la persona es hipertensa, por favor' }],
  };
  for (const w of [80, 58] as const) {
    assertFits(buildTicket(long, header(w)));
    assertFits(buildTicket(sampleTicket('kitchen'), header(w)));
    assertFits(buildTicket(sampleTicket('cash'), header(w)));
    assertFits(buildTicket({ ...sampleTicket('cash'), total: 123456789.99 }, header(w)));
  }
  assert.equal(buildTicket(long, header(80)).columns, 48);
  assert.equal(buildTicket(long, header(58)).columns, 32);
});

test('comanda: mesa por su nombre, hora local, platos grandes, opciones y nota aparte; sin precios', () => {
  const doc = kitchenTicket(sampleTicket('kitchen'), header());
  const t = texts(doc);
  assert.ok(t.includes('VENTANA'));
  assert.ok(t.some(l => l.startsWith('Pedido #1234') && l.endsWith('22:30')));
  assert.ok(t.includes('Mozo: Juan'));
  const dish = doc.lines.find(l => l.text.startsWith('2x Milanesa'))!;
  assert.equal(dish.size, 'double');
  assert.ok(t.includes('   SIN jamón'));
  assert.ok(t.includes('   >> Una bien cocida'));
  assert.ok(!t.some(l => l.includes('SECTOR')));
  assert.ok(t.indexOf('ENTRADAS') < t.indexOf('PRINCIPAL'));
  assert.ok(t.some(l => l.includes('6 platos')));
  assert.ok(!t.some(l => l.includes('$')));
});

test('comanda vieja sin modifiers: usa notes; para llevar y cambios tienen su título', () => {
  const doc = kitchenTicket({ type: 'kitchen', isTakeaway: true, takeawayName: 'Ana', items: [{ name: 'Pizza', quantity: 1, notes: 'SIN aceitunas · cortada en 8' }] }, header());
  const t = texts(doc);
  assert.equal(t[1], 'PARA LLEVAR');
  assert.ok(t.includes('ANA'));
  assert.ok(t.includes('   >> SIN aceitunas · cortada en 8'));
  assert.equal(kitchenTicket({ type: 'kitchen', heading: 'REHACER', tableNumber: 3, items: [] }, header()).lines[1].text, 'REHACER');
  assert.equal(ticketTitle({ type: 'kitchen', heading: 'CAMBIO', tableLabel: 'Patio', orderNumber: 7, items: [] }), 'Comanda (cambio) · Patio · #7');
});

test('ticket de caja: descuento, total, cada medio de pago y el vuelto', () => {
  const t = texts(cashTicket(sampleTicket('cash'), header()));
  assert.ok(t.includes('No válido como factura'));
  assert.ok(t.some(l => l.startsWith('Fecha: 18/11/2026') && l.endsWith('22:30 hs')));
  assert.ok(t.some(l => l.startsWith('Subtotal') && l.endsWith('$68.900,00')));
  assert.ok(t.some(l => l.startsWith('Descuento 10 % (Promo efectivo)') && l.endsWith('-$6.890,00')));
  assert.ok(t.some(l => l.startsWith('TOTAL') && l.endsWith('$62.010,00')));
  assert.ok(t.some(l => l.startsWith('   Vuelto') && l.endsWith('$7.990,00')));

  const mixed = texts(cashTicket({
    type: 'cash', tableLabel: 'Mesa 2', items: [{ name: 'Pizza', quantity: 1, price: 10000 }], total: 10000,
    paymentMethod: 'MIXED', payments: [{ method: 'CARD', amount: 6000 }, { method: 'CASH', amount: 4000, tendered: 4000 }],
  }, header()));
  assert.ok(mixed.some(l => l.startsWith('Tarjeta') && l.endsWith('$6.000,00')));
  assert.ok(mixed.some(l => l.startsWith('Efectivo') && l.endsWith('$4.000,00')));
  assert.ok(!mixed.some(l => l.includes('Vuelto')));
});

test('ticket a cuenta: de quién es la deuda y lugar para la firma', () => {
  const t = texts(cashTicket({
    type: 'cash', tableLabel: 'Ventana', items: [{ name: 'Menú del día', quantity: 4, price: 9000 }], total: 36000,
    paymentMethod: 'ACCOUNT', customerName: 'Municipalidad',
  }, header()));
  assert.ok(t.includes('A CUENTA DE: MUNICIPALIDAD'));
  assert.ok(t.some(l => l.startsWith('Firma: ___')));
  assert.ok(!t.some(l => l.startsWith('Efectivo')));
});

test('printable: lo que la comandera no tiene sale como "?"; comillas y guiones se simplifican', () => {
  assert.equal(printable('Ñoquis ¡ricos! · 1°'), 'Ñoquis ¡ricos! · 1°');
  assert.equal(printable('Pizza 🍕'), 'Pizza ?');
  assert.equal(printable('10 €'), '10 ?'); // PC850 no tiene el euro
  assert.equal(printable('“Especial” – x2'), '"Especial" - x2');
});

test('ESC/POS: inicia, apaga el modo chino, elige PC850 (2), acentos en la tabla, negrita/tamaño y corte al final', () => {
  const doc: TicketDoc = { paperWidth: 80, columns: 48, lines: [
    { text: 'Ñoquis', bold: true, size: 'double', align: 'center' },
    { text: 'Puré' },
  ] };
  const b = toEscPos(doc);
  assert.deepEqual([...b.subarray(0, 7)], [0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 2]);
  // Primera línea: centrado, ESC ! (negrita + alto + ancho), ESC E 1, "Ñoquis" con Ñ = 0xA5
  assert.deepEqual([...b.subarray(7, 16)], [0x1b, 0x61, 1, 0x1b, 0x21, 0x38, 0x1b, 0x45, 1]);
  assert.equal(b[16], 0xa5);
  assert.ok(b.includes(Buffer.from([0x50, 0x75, 0x72, 0x82]))); // "Pur" + é
  assert.deepEqual([...b.subarray(-3)], [0x1d, 0x56, 0x01]);
  assert.equal(toEscPos(doc, { cut: false }).at(-1), 4); // sin corte: termina en el avance de papel
});
