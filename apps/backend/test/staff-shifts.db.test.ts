// ──────────────────────────────────────────────
// Horarios del personal: entrada/salida, turnos a mano, semana lunes a domingo
// (hora del local), turnos que pasan la medianoche y pago = horas × valor por hora.
// ──────────────────────────────────────────────
import './db-env.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { prisma } from '../src/lib/prisma.js';
import { initSocket } from '../src/sockets/index.js';
import { HttpError } from '../src/lib/http-error.js';
import { staffShiftsService } from '../src/modules/staff/staff-shifts.service.js';
import { staffService } from '../src/modules/staff/staff.service.js';
import { addDays, startOfLocalDay, weekStartOf } from '../src/lib/time.js';

const httpServer = http.createServer();
before(() => { initSocket(httpServer); });
after(async () => {
  await prisma.restaurant.deleteMany();
  await prisma.$disconnect();
  httpServer.close();
});
beforeEach(async () => { await prisma.restaurant.deleteMany(); });

const isHttp = (status: number) => (err: unknown) => err instanceof HttpError && err.statusCode === status;
/** Instante de un día y hora del local (Buenos Aires). */
const at = (day: string, time: string) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(startOfLocalDay(day).getTime() + (h * 60 + m) * 60_000);
};

async function setup(rate: number | null = 3000) {
  const r = (await prisma.restaurant.create({ data: { name: 'Test' } })).id;
  const member = await staffService.create(r, { name: 'Cande', email: 'cande@test.com', role: 'CHEF', hourlyRate: rate });
  return { r, id: member.id };
}

test('la semana va de lunes a domingo', () => {
  assert.equal(weekStartOf('2026-11-02'), '2026-11-02'); // lunes
  assert.equal(weekStartOf('2026-11-08'), '2026-11-02'); // domingo
  assert.equal(weekStartOf('2026-11-09'), '2026-11-09'); // lunes siguiente
  assert.equal(weekStartOf('2026-01-01'), '2025-12-29'); // cruza el año
});

test('marca entrada y salida; no deja dos entradas ni dos salidas', async () => {
  const { r, id } = await setup();
  const shift = await staffShiftsService.clockIn(r, id, null);
  assert.equal(shift.clockOut, null);
  assert.equal(Number(shift.hourlyRate), 3000);
  await assert.rejects(staffShiftsService.clockIn(r, id, null), isHttp(409));

  const out = await staffShiftsService.clockOut(r, id);
  assert.ok(out.clockOut);
  assert.equal(out.openKey, null);
  await assert.rejects(staffShiftsService.clockOut(r, id), isHttp(409));
});

test('dos entradas a la vez: solo una queda', async () => {
  const { r, id } = await setup();
  const results = await Promise.allSettled([
    staffShiftsService.clockIn(r, id, null),
    staffShiftsService.clockIn(r, id, null),
    staffShiftsService.clockIn(r, id, null),
  ]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(await prisma.staffShift.count({ where: { staffMemberId: id } }), 1);
});

test('suma la semana: horas × valor por hora, con el turno de medianoche en el día que empezó', async () => {
  const { r, id } = await setup(3000);
  const add = (day: string, from: string, to: string, nextDay = false) =>
    staffShiftsService.create(r, {
      staffMemberId: id, clockIn: at(day, from),
      clockOut: nextDay ? at(addDays(day, 1), to) : at(day, to), reason: 'carga de prueba', userId: null,
    });
  await add('2026-11-03', '18:00', '23:30');              // martes: 5 h 30
  await add('2026-11-08', '20:00', '01:15', true);        // domingo a lunes 01:15: 5 h 15, cuenta el domingo
  await add('2026-11-09', '18:00', '22:00');              // lunes siguiente: otra semana

  const w = await staffShiftsService.week(r, '2026-11-05');
  assert.equal(w.weekStart, '2026-11-02');
  assert.equal(w.weekEnd, '2026-11-08');
  const cande = w.staff.find(s => s.id === id)!;
  assert.equal(cande.shifts.length, 2);
  assert.deepEqual(cande.shifts.map(s => s.day), ['2026-11-03', '2026-11-08']);
  assert.equal(cande.minutes, 330 + 315);
  assert.equal(cande.amount, 32250);             // 10,75 h × $3.000
  assert.equal(w.totals.amount, 32250);

  const next = await staffShiftsService.week(r, '2026-11-09');
  assert.equal(next.staff.find(s => s.id === id)!.minutes, 240);
});

test('el pago se redondea al centavo y usa el valor por hora que tenía al entrar', async () => {
  const { r, id } = await setup(2999.99);
  await staffShiftsService.create(r, {
    staffMemberId: id, clockIn: at('2026-11-03', '10:00'), clockOut: at('2026-11-03', '10:07'), reason: 'prueba', userId: null,
  });
  // Cambiar el valor después no cambia lo ya trabajado
  await staffService.update(r, id, { hourlyRate: 5000 });
  const w = await staffShiftsService.week(r, '2026-11-03');
  const cande = w.staff.find(s => s.id === id)!;
  assert.equal(cande.amount, 350);               // 7 min × 2999,99/60 = 349,9988 → 350,00
  assert.equal(cande.hourlyRate, 5000);
  // El cambio de valor queda en la auditoría
  assert.equal(await prisma.auditLog.count({ where: { restaurantId: r, action: 'staff.rate' } }), 1);
});

test('sin valor por hora: suma las horas pero avisa que falta el valor', async () => {
  const { r, id } = await setup(null);
  await staffShiftsService.create(r, {
    staffMemberId: id, clockIn: at('2026-11-03', '10:00'), clockOut: at('2026-11-03', '12:00'), reason: 'prueba', userId: null,
  });
  const cande = (await staffShiftsService.week(r, '2026-11-03')).staff.find(s => s.id === id)!;
  assert.equal(cande.minutes, 120);
  assert.equal(cande.amount, 0);
  assert.equal(cande.missingRate, true);
});

test('rechaza turnos que se pisan, al revés o demasiado largos; corrige y borra con auditoría', async () => {
  const { r, id } = await setup();
  const s = await staffShiftsService.create(r, {
    staffMemberId: id, clockIn: at('2026-11-03', '18:00'), clockOut: at('2026-11-03', '23:00'), reason: 'prueba', userId: null,
  });
  await assert.rejects(staffShiftsService.create(r, {
    staffMemberId: id, clockIn: at('2026-11-03', '22:00'), clockOut: at('2026-11-04', '01:00'), reason: 'prueba', userId: null,
  }), isHttp(409));
  await assert.rejects(staffShiftsService.create(r, {
    staffMemberId: id, clockIn: at('2026-11-05', '18:00'), clockOut: at('2026-11-05', '17:00'), reason: 'prueba', userId: null,
  }), isHttp(400));
  await assert.rejects(staffShiftsService.create(r, {
    staffMemberId: id, clockIn: at('2026-11-05', '08:00'), clockOut: at('2026-11-06', '06:00'), reason: 'prueba', userId: null,
  }), isHttp(400));

  const fixed = await staffShiftsService.update(r, s.id, { clockIn: at('2026-11-03', '19:00'), reason: 'llegó tarde' });
  assert.equal(fixed.clockIn.getTime(), at('2026-11-03', '19:00').getTime());
  await staffShiftsService.remove(r, s.id, 'cargado por error');
  const actions = (await prisma.auditLog.findMany({ where: { restaurantId: r }, orderBy: { id: 'asc' } })).map(a => a.action);
  assert.deepEqual(actions, ['staff.shift.create', 'staff.shift.update', 'staff.shift.delete']);
});

test('no se borra la ficha de alguien con horarios (se desactiva)', async () => {
  const { r, id } = await setup();
  await staffShiftsService.create(r, {
    staffMemberId: id, clockIn: at('2026-11-03', '10:00'), clockOut: at('2026-11-03', '12:00'), reason: 'prueba', userId: null,
  });
  await assert.rejects(staffService.remove(r, id), isHttp(409));
  // Desactivado sigue apareciendo en la semana en que trabajó
  await staffService.toggleActive(r, id);
  assert.equal((await staffShiftsService.week(r, '2026-11-03')).staff.length, 1);
  assert.equal((await staffShiftsService.week(r, '2026-11-10')).staff.length, 0);
});
