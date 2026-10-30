// ──────────────────────────────────────────────
// time.test.ts — Días locales (Buenos Aires, UTC-3) contra UTC
// ──────────────────────────────────────────────
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, formatLocalDateTime, isDayKey, localDayKey, localDaysRange, startOfLocalDay,
} from '../src/lib/time.js';
import { dayParam, rangeParams } from '../src/lib/date-query.js';

test('una venta a las 22:30 hora local cae en el día local, no en el siguiente', () => {
  // 29/10 22:30 en Buenos Aires = 30/10 01:30 UTC
  const sale = new Date('2026-10-30T01:30:00Z');
  assert.equal(localDayKey(sale), '2026-10-29');
  assert.equal(formatLocalDateTime(sale), '2026-10-29 22:30:00');

  const { from, to } = localDaysRange('2026-10-29');
  assert.ok(sale >= from && sale <= to);
});

test('el día local va de las 00:00 a las 23:59:59.999 de Buenos Aires', () => {
  const { from, to } = localDaysRange('2026-10-29');
  assert.equal(from.toISOString(), '2026-10-29T03:00:00.000Z');
  assert.equal(to.toISOString(), '2026-10-30T02:59:59.999Z');
  // 00:30 local del 30 ya es otro día
  assert.equal(localDayKey(new Date('2026-10-30T03:30:00Z')), '2026-10-30');
});

test('rangos de varios días y cambio de mes/año', () => {
  const { from, to } = localDaysRange('2026-12-31', '2027-01-01');
  assert.equal(from.toISOString(), '2026-12-31T03:00:00.000Z');
  assert.equal(to.toISOString(), '2027-01-02T02:59:59.999Z');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(startOfLocalDay('2026-01-01').toISOString(), '2026-01-01T03:00:00.000Z');
});

test('validación de días', () => {
  assert.ok(isDayKey('2026-10-29'));
  assert.ok(!isDayKey('2026-02-30'));
  assert.ok(!isDayKey('29/10/2026'));
});

test('parámetros de query: días locales e instantes ISO', () => {
  assert.equal(dayParam.parse('2026-10-29'), '2026-10-29');
  // Instante de medianoche argentina enviado como ISO (clientes viejos)
  assert.equal(dayParam.parse('2026-10-29T03:00:00.000Z'), '2026-10-29');
  assert.throws(() => dayParam.parse('ayer'));

  const r = rangeParams.parse({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(r.from.toISOString(), '2026-10-01T03:00:00.000Z');
  assert.equal(r.to.toISOString(), '2026-11-01T02:59:59.999Z');
  assert.throws(() => rangeParams.parse({ from: '2026-10-31', to: '2026-10-01' }));
});
